# Spec Delta

## ADDED Requirements

### Requirement: Lane review unit

A checked task without a current `PASS` SHALL belong to exactly one review unit: the checked tasks of
its `tasks.md` level-2 section when that section resolves, or a per-task unit when it does not. A
section unit SHALL cover every checked task of the section, including tasks that already have a
`PASS`. `FINDINGS` and `ERROR` records MUST NOT satisfy a unit; only a current `PASS` does. An
unreadable plan keeps the per-task unit.

#### Scenario: One missing task is one lane unit

- **WHEN** a checked task has no current `PASS` and its level-2 section resolves
- **THEN** the section is one review unit covering every checked task of the section, and its start uses the section selector

#### Scenario: Task outside a section is per-task

- **WHEN** a checked task has no current `PASS` and belongs to no resolvable level-2 section
- **THEN** the unit is that single task and its start uses the task selector

#### Scenario: FINDINGS is not coverage

- **WHEN** a checked task's latest record is `FINDINGS` or `ERROR`
- **THEN** the unit remains due and only a current `PASS` clears it

#### Scenario: Unreadable plan keeps per-task units

- **WHEN** the change's `tasks.md` cannot be read
- **THEN** the review units stay per-task instead of failing the gate

### Requirement: Review unit thread continuity

The review prompt SHALL name a stable unit key (`review:<change>:section:<key>`,
`review:<change>:task:<id>`, or `review:<change>:whole:<phase>`) and the unit's snapshot checkout
SHALL live at a path derived from that key, so the same provider thread is resumed on every round. A
task or section round after `FINDINGS` SHALL carry the prior findings and diff into that thread; a
whole-scope round SHALL be a full review in the same thread.

#### Scenario: Same unit resumes the thread

- **WHEN** a unit is reviewed again after `FINDINGS`
- **THEN** the prompt carries the same unit key and the provider resumes the prior review thread

#### Scenario: Different unit starts a thread

- **WHEN** the unit key differs
- **THEN** the provider starts a new thread and never resumes another unit's conversation

#### Scenario: Task round returns the fixes

- **WHEN** a task or section unit is re-reviewed
- **THEN** the prompt carries the complete prior-finding inventory and the diff from the reviewed tree

#### Scenario: Whole-scope round is full

- **WHEN** a whole-scope unit is re-reviewed
- **THEN** the prompt is a full review in the same thread, not a focused diff round

### Requirement: Parallel review admission

Every distinct review SHALL be admitted immediately: the engine MUST NOT impose a concurrency limit,
a waiting list, or an admission timeout on review runs, and a review start MUST NOT be refused
because the generic open-run limit is reached. Every due unit of one close SHALL start in the same
pass. Only reviews that share one unit's provider thread SHALL serialize. A provider active-child
limit SHALL defer an attempt as a transient failure, not as an engine queue.

#### Scenario: All due lanes start together

- **WHEN** several lanes and a whole-scope review are due at one close
- **THEN** every unit starts its review in that pass and no unit waits for another

#### Scenario: No queue position

- **WHEN** more reviews are admitted than ever ran at once
- **THEN** each one starts immediately and the status reports no queue position or waiting time

#### Scenario: Same unit serializes

- **WHEN** two reviews would share one unit's provider thread
- **THEN** the second waits for the first because the thread is shared, not because of an engine cap

#### Scenario: Provider child limit retries

- **WHEN** the provider reports its own active-child limit
- **THEN** the attempt is classified transient, retried with backoff, and no engine queue is created

### Requirement: Waiting close for a live review

While every due review unit has a live review run, the turn close SHALL be allowed as a waiting
close and MUST NOT submit any steering, follow-up, or injected message to the agent: the turn ends so
the asynchronous verdict can start the next one. The close MUST record no `VIOLATION`. Only a current
`PASS` SHALL end a unit's obligation; `FINDINGS`, `ERROR`, and a failed start leave it due. The close
MUST NOT be released by a refusal budget while a unit is due and no review is live.

#### Scenario: Waiting close is allowed

- **WHEN** every due unit has a live review and no other obligation is open
- **THEN** the close is allowed with no message to the agent and no `VIOLATION` is recorded

#### Scenario: Waiting close does not reopen the turn

- **WHEN** the gate allows the waiting close while several review runs are live
- **THEN** no step starts after it, and only the verdict delivery or a later user turn begins new work

#### Scenario: No PASS means no approval

- **WHEN** the turn closes as a waiting close
- **THEN** no unit is approved and the next close still requires a current `PASS`

#### Scenario: FINDINGS starts the next round

- **WHEN** a review settles `FINDINGS`
- **THEN** the unit stays due and the next close starts the next round on the same unit key

#### Scenario: ERROR is not a pass

- **WHEN** a review settles `ERROR`
- **THEN** the unit stays due, the next close retries the round, and the close is not released by the error

### Requirement: Whole-scope review snapshot

A `spec-review` and `integration-review` SHALL review a frozen snapshot of their inputs. A spec review
SHALL bind only the change artifacts it read, with `tasks.md` checkbox state normalized, and MUST NOT
bind the worktree; an integration review SHALL bind the worktree digest captured at snapshot time.
Work outside the reviewed scope MUST NOT discard the verdict or invalidate the record; only a changed
reviewed plan SHALL require a new round in the same thread.

#### Scenario: Write during a whole-spec review

- **WHEN** the agent edits a reviewed change artifact while a whole-spec review runs
- **THEN** the review publishes its verdict for the snapshot, writes no input-change `ERROR`, and its record is stale against the edited artifacts

#### Scenario: Parallel worktree work does not invalidate the spec review

- **WHEN** another worktree path is written during or after a whole-spec review
- **THEN** the verdict is published and the spec `PASS` stays current, with no input-change `ERROR` and no new round

#### Scenario: Stale record needs a new round

- **WHEN** the reviewed plan artifacts change after a whole-spec `PASS`
- **THEN** the step stays open, the unit is due, and the next close starts a round on the same thread

#### Scenario: Task ticks do not invalidate

- **WHEN** tasks are ticked after a whole-spec `PASS`
- **THEN** the normalized artifact digest is unchanged and the `PASS` stays current for the archive

#### Scenario: Integration review uses the snapshot

- **WHEN** an integration review starts after the task list is complete
- **THEN** it reads the frozen worktree snapshot and its digest binds the worktree digest captured at snapshot time

### Requirement: Required integration review

`integration-review` SHALL be a required review: it MUST NOT be `nonCritical`, MUST NOT settle
`completed-soft`, and MUST iterate until a current `PASS` like the other reviews. The agent archive
path SHALL refuse while its current `PASS` is missing or stale when the plan is complete and
non-empty. The user-clicked archive remains the explicit human override.

#### Scenario: Integration FINDINGS loops

- **WHEN** the integration review returns `FINDINGS`
- **THEN** the change stays incomplete and the next round re-asks the same integration thread

#### Scenario: Archive requires integration PASS

- **WHEN** the task list is complete and non-empty and the current integration `PASS` is missing or stale
- **THEN** the agent's `openspec archive` call is refused and names the missing integration review

#### Scenario: User click overrides

- **WHEN** the user clicks archive while the integration record is stale
- **THEN** the click service still authorizes the archive as the explicit human override

## MODIFIED Requirements

### Requirement: Turn-close gate

When a root turn stops and an active run has an open `blockTurnClose` step that is owned and not deferred, the engine SHALL steer and refuse the close up to `maxBlocks`. After the cap it SHALL allow the close once and record a visible `VIOLATION` that is not a pass. A run that has reached its owned `review` step MUST NOT be released by that budget: while a due review unit has no live review the close SHALL be refused, and while every due unit has a live review it SHALL be allowed as a waiting close with no `VIOLATION` and no message. It MUST fail open on an internal error and MUST NOT evaluate a subagent turn.

A user stop SHALL win over the gate: when the turn's abort signal is set, the gate MUST NOT start a
review, persist an outcome, or submit a message, and a message it already submitted SHALL be removed
from the agent inbox when that signal aborts, so no queued gate message resumes a stopped turn.

#### Scenario: Close is refused

- **WHEN** a required owned step is open at the turn stop
- **THEN** the close is refused and the steer names the step and evidence

#### Scenario: Cap allows a marked close

- **WHEN** a non-review run reaches `maxBlocks` refusals
- **THEN** the turn closes once with a visible `VIOLATION` and is not reported as a pass

#### Scenario: Review close has no cap

- **WHEN** a due review unit has no live review at the turn stop
- **THEN** the close is refused regardless of prior refusals, the next round starts, and no `VIOLATION` is recorded for the review

#### Scenario: Live review allows the waiting close

- **WHEN** every due review unit has a live review
- **THEN** the close is allowed with no message and no `VIOLATION`

#### Scenario: A stopped turn is never steered

- **WHEN** the turn's abort signal is set before the gate dispatches or submits anything
- **THEN** no review starts, no message is submitted, and the stopped turn is not resumed

#### Scenario: A submitted gate message does not survive a stop

- **WHEN** the gate submitted a steering message and the turn's abort signal aborts before the message is claimed
- **THEN** the message is removed from the inbox and no new turn starts from it

#### Scenario: Internal error fails open

- **WHEN** the gate throws while evaluating a run
- **THEN** the turn closes and the error is recorded in the run

#### Scenario: Subagent turn is exempt

- **WHEN** a subagent turn stops
- **THEN** the gate does not evaluate it

### Requirement: Whole-spec review evidence

A whole-spec review record SHALL be read from `.dsh/workflows/records/spec-review/<change>/spec.json`.
The legacy `.dsh/delegation/spec-review/<change>/spec.json` path and the `defer` ownership path are
removed with the delegation plugin, so no enabled legacy switch can select a legacy record. The
record MUST match `rule: spec-review`, the change name, `phase: spec`, `scope: whole`, and a digest
equal to the current change spec digest; only `PASS` completes the step, while an `ERROR` settles the
attempt, MUST NOT approve, and leaves the change due for the next round. A task-scoped record MUST
NOT satisfy a whole-spec step.

#### Scenario: Whole-spec record completes the review step

- **WHEN** `.dsh/workflows/records/spec-review/auth/spec.json` has rule `spec-review`, change `auth`, phase `spec`, scope `whole`, verdict `PASS`, and the current spec digest
- **THEN** the review step is marked done with the record path and digest

#### Scenario: ERROR allows an intermediate close

- **WHEN** the whole-spec record is `ERROR` and the next close starts a new review
- **THEN** the turn may close as a waiting close with the failure visible, no `PASS` exists, and the review continues on the same thread

#### Scenario: Legacy record is not consulted

- **WHEN** only `.dsh/delegation/spec-review/auth/spec.json` exists
- **THEN** the step reads no record and its ownership cannot select a legacy path

#### Scenario: Stale whole-spec record blocks

- **WHEN** the record's digest differs from the current change spec digest
- **THEN** the step is not done and the close steers a fresh whole-spec review

#### Scenario: Task-scoped record is not whole-spec evidence

- **WHEN** only a task-scoped `PASS` exists for the change
- **THEN** the whole-spec step remains open

### Requirement: Pre-execute archive gate

The engine SHALL refuse `openspec archive <change>` while a required review or spec-review step is open, no authenticated completed `change-intake` run or authenticated receipt exists, the current whole-spec `PASS` record is missing or stale, or the task list is complete and non-empty and the current `integration-review` `PASS` is missing or stale. A receipt MUST verify its host HMAC; a forged or unsigned receipt MUST NOT satisfy the gate. The refusal SHALL name the run, step, and missing evidence. It MUST allow the archive when the evidence is present and MUST NOT treat a text claim as evidence. When a shell command carries a shell separator and contains an archive invocation or archive move that the parser cannot understand, the engine SHALL refuse the call with the existing "could not be parsed safely" reason instead of allowing it; a compound command that names no archive SHALL NOT be refused by this rule.

#### Scenario: Archive is refused

- **WHEN** a required review step is open for the change
- **THEN** the archive is refused with the run, step, and missing evidence

#### Scenario: No intake run

- **WHEN** no completed `change-intake` run or authenticated receipt exists for the change
- **THEN** the archive is refused with the missing intake run and its next step

#### Scenario: Stale review blocks archive

- **WHEN** the whole-spec record's digest does not match the current change artifacts
- **THEN** the archive is refused with the stale record and the next review action

#### Scenario: Stale integration review blocks archive

- **WHEN** the task list is complete and non-empty and the integration record is missing or its worktree digest is stale
- **THEN** the archive is refused with the stale integration review and the next review action

#### Scenario: Adopted change archives

- **WHEN** a pre-existing change has a valid host-authenticated adoption receipt
- **THEN** the archive gate accepts the receipt and does not require a recreated directory

#### Scenario: Receipt survives pruning

- **WHEN** the run history is pruned after a successful intake and the current whole-spec `PASS` record exists
- **THEN** the valid authenticated receipt still lets the archive gate accept the completed intake

#### Scenario: Archive is allowed

- **WHEN** every required step has verified evidence
- **THEN** the archive is allowed

#### Scenario: Text claim is refused

- **WHEN** the model claims the review passed without a PASS record
- **THEN** the archive remains refused

#### Scenario: Separator cannot hide an unparsed archive

- **WHEN** a shell command contains `openspec archive <change>` after a `;`, `&&`, `||`, newline, or `cd` compound command and the parser cannot read it as one documented invocation
- **THEN** the call is refused with the "could not be parsed safely" reason and the command does not run

#### Scenario: Quoted or compound archive move is refused

- **WHEN** a command moves a change into the archive with a quoted destination or another command after the destination, such as `git status; git mv openspec/changes/auth "openspec/changes/archive"` or `cd .; mv openspec/changes/auth openspec/changes/archive; pwd`
- **THEN** the call is refused with the "could not be parsed safely" reason and the move does not run

#### Scenario: A quoted or commented mention is refused

- **WHEN** a compound command contains an archive invocation or archive move only inside quoted text or a comment
- **THEN** the call is refused with the "could not be parsed safely" reason rather than interpreted

#### Scenario: Benign compound command is not an archive

- **WHEN** a compound shell command names no archive invocation or archive move
- **THEN** the archive gate does not refuse it and the call proceeds

### Requirement: Retirement parity

A legacy gate behavior SHALL move to a workflow `own` definition only after a release-bound parity
report passes. The report SHALL be a tracked asset at `assets/parity/retire-legacy-gates.json`, replay
legacy scenarios in shadow, and include the covered template hashes. The replay SHALL run from a retained
executable baseline in the workflows test package that imports no deleted plugin code; a baseline change
MUST regenerate the report before `--check` passes again. `pnpm workflows:parity --check` MUST fail on a
missing, stale, or mismatched report or a missing baseline evaluator; a fresh installation SHALL load the
shipped report and `own` definitions. The `integration-review` is now a required review, so the legacy
soft integration scenario SHALL NOT be replayed and its parity entry SHALL be removed from the report;
the removal is a declared, documented difference and MUST NOT count as a parity mismatch. The remaining
scenarios, the report, and the template hashes SHALL be regenerated together. After the delegation plugin
is removed, a failing parity report is remedied by fixing the report, the retained baseline, or the
definition; no legacy switch is available to re-enable.

#### Scenario: Parity passes

- **WHEN** every retained legacy scenario produces the same allow/refuse decision in the workflow shadow run
- **THEN** the workflow definition may be `own`

#### Scenario: Soft signal keeps its refusal sequence

- **WHEN** the legacy soft integration entry is compared after the integration review became required
- **THEN** the entry is retired as a declared difference, no soft refusal sequence is replayed, and `--check` passes with the regenerated report

#### Scenario: Exhausted soft run does not block archive

- **WHEN** an old run settled on the retired soft budget, every checked task has a `PASS`, and the intake receipt exists
- **THEN** the old settlement approves nothing, the archive still requires the current integration `PASS`, and the exhausted old run does not block the archive by itself

#### Scenario: Soft integration entry is retired

- **WHEN** the parity report is regenerated after the integration review became required
- **THEN** the legacy soft integration entry is absent, the removal is named as a declared difference, and `--check` passes

#### Scenario: Parity mismatch has no legacy fallback

- **WHEN** a retained scenario mismatches after the plugin is removed
- **THEN** `pnpm workflows:parity --check` fails and the remedy names the report, the retained baseline, or the definition, not a legacy switch

#### Scenario: Fresh installation

- **WHEN** a fresh installation loads the shipped report and `own` definitions
- **THEN** the shipped parity report, the settings matrix, and the matching `own` definitions are present, their template hashes match, and all load successfully

#### Scenario: Parity fails

- **WHEN** a retained scenario differs, the report is missing, a template hash changed, or a gate status is not `pass`
- **THEN** `pnpm workflows:parity --check` fails with the scenario or the expected and actual hash and the owned definition is refused

#### Scenario: Report is release-bound

- **WHEN** a definition template changes after the report was generated
- **THEN** `--check` fails with the definition id and the expected and actual template hash, and the release is blocked

#### Scenario: Missing report at runtime

- **WHEN** an installed profile has no readable or matching report
- **THEN** the loader refuses the `own` definition with the report path, the expected and actual hash, and the `pnpm workflows:parity` remedy

#### Scenario: Baseline outlives the runtime

- **WHEN** the delegation plugin is absent and every retained scenario still matches the retained executable baseline
- **THEN** `pnpm workflows:parity --check` passes and the `own` definitions load

#### Scenario: Edited baseline is stale

- **WHEN** a retained baseline decision changes without regenerating the tracked report
- **THEN** `--check` fails and names the stale report instead of certifying the edited baseline

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through the review executor only when
no matching `PASS` record exists for the run's unit; a matching `PASS` SHALL settle the review step from
that record without starting a review. The unit SHALL be the lane unit of `Lane review unit` or a
per-task unit. It SHALL accept a matching `PASS` as intermediate turn-close evidence and SHALL refuse
the close while the unit's latest record is `FINDINGS`, `ERROR`, or missing; a `FINDINGS` or `ERROR`
record MUST leave the unit due and the next close SHALL advance or start the round on the same unit
key. Before advancing any nonterminal task-review run it SHALL compare the run's checked task id with
`openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the id is absent, regardless
of which step is pending, and MUST NOT start a second run for the same unit while a live-session run for
that unit is open. A failed review start SHALL remain retryable across closes and MUST NOT become
terminal or release the close. The completion-coverage and work-progress checks SHALL still refuse a
final tick without a portable `PASS`, and the archive gate SHALL still require a `PASS` for every
checked task. The workflow SHALL start every due unit of a change in one pass, in parallel.

#### Scenario: Review is started

- **WHEN** a unit has no current `PASS`, the workflow is `own`, and no live run covers it
- **THEN** the workflow starts the review through the review executor and records the run

#### Scenario: Matching record settles the start step

- **WHEN** a unit already has a matching `PASS` record
- **THEN** the review step settles from that record without starting a review and the run advances to its coverage step

#### Scenario: Section unit covers approved tasks

- **WHEN** a section contains an approved checked task and one missing task
- **THEN** the one lane run covers every checked task in the section, preserves a matching per-task approval byte-identically, and publishes only the missing or nonmatching approvals

#### Scenario: Single missing task keeps the task unit

- **WHEN** a section has exactly one checked task without a current `PASS`
- **THEN** the previous per-task selection is retired and that section's lane unit is selected

#### Scenario: All due units start together

- **WHEN** two or more sections are due at one close
- **THEN** the workflow starts every due lane unit in that pass and no lane waits for another

#### Scenario: Removed task is superseded

- **WHEN** a task-review run's checked task id is no longer present in `tasks.md`
- **THEN** the run is cancelled as superseded before the next advance, regardless of which step is pending, and names the missing task

#### Scenario: Restored task starts a fresh run

- **WHEN** a superseded run's task text is restored and checked again
- **THEN** the cancelled run is not resumed and a fresh task-review run starts for the restored task

#### Scenario: Duplicate run is suppressed

- **WHEN** a task-review run for the same change and unit is open in a live session
- **THEN** no second run starts for that unit

#### Scenario: Dispatch failure is bounded

- **WHEN** a review start fails with a transient class
- **THEN** the attempt retries with bounded backoff up to `maxAttempts` and the unit stays due

#### Scenario: Exhausted dispatch is terminal

- **WHEN** the transport retries for one attempt are exhausted
- **THEN** an `ERROR` is recorded and the run may fail, but the unit stays due and the next close starts a new round; the obligation never becomes terminal

#### Scenario: Failed step resumes

- **WHEN** a failed task-review run is resumed
- **THEN** its review step reopens and a later advance starts the review again

#### Scenario: FINDINGS is refused

- **WHEN** the review returns `FINDINGS`
- **THEN** the workflow refuses the close, names the next review action, and leaves the unit due

#### Scenario: ERROR closes an intermediate turn but does not approve

- **WHEN** the review returns `ERROR`
- **THEN** the unit stays unapproved, the next close starts another round, and the turn may close only as a waiting close once that round is live

#### Scenario: PASS approves

- **WHEN** every checked task has a matching `PASS` record
- **THEN** the turn may close and the archive gate allows the archive

#### Scenario: Archive is gated

- **WHEN** a change has a checked task without a `PASS`
- **THEN** the archive gate refuses and names the run and the missing task

#### Scenario: Section with two missing tasks is one unit

- **WHEN** section 1 has two or more checked tasks without a matching `PASS` record
- **THEN** the workflow selects one lane unit for section 1 and starts no per-task review for its missing tasks

#### Scenario: Pending section run suppresses a duplicate

- **WHEN** a lane run for the change's section is running
- **THEN** the gate points at that run and starts no per-task or second lane run for its covered tasks

#### Scenario: Steer names the section

- **WHEN** the turn-close gate refuses for missing records in a section
- **THEN** the steer names the section key, the missing tasks, and the start action that covers them

#### Scenario: Review runtime remains

- **WHEN** no legacy task-review rule exists
- **THEN** the review executor, its queue, and its records still work

### Requirement: Review executor

A step MAY use the `review` executor with a `target`, an `instruction`, a `scope` (`whole` or
`task`), and an optional `phase`. The engine SHALL resolve the target from `reviewers`, run the
reviewer with the configured model and effort, render the unit key and the prepared digest into the
prompt, accept exactly one fenced JSON verdict that echoes the prepared digest, write the record, and
settle the step from a matching record. A task or section review SHALL read a frozen snapshot; a
whole-scope review SHALL read a frozen snapshot of its inputs. A malformed verdict, a digest mismatch,
a target failure, or a timeout SHALL write an `ERROR` record and publish no `PASS`. A reviewed-input
change SHALL discard a verdict only on the live fallback.

#### Scenario: Task review reads a frozen snapshot

- **WHEN** a task-scope review starts
- **THEN** it reads a frozen worktree snapshot taken at the start, so a later write neither enters nor invalidates its evidence

#### Scenario: Whole-scope review reads a frozen snapshot

- **WHEN** a whole-scope review starts
- **THEN** it reads a frozen snapshot of its worktree and change-artifact inputs, and a later write makes its record stale instead of discarding the verdict

#### Scenario: Task review settles from its record

- **WHEN** a task-scope review returns PASS for the prepared snapshot digest
- **THEN** the local record and the committed approval are written and the step is marked done with the record path

#### Scenario: Malformed verdict writes an error

- **WHEN** the reviewer returns prose, two fenced blocks, an invalid severity, or a digest that does not match
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

#### Scenario: Changed whole-scope inputs discard the verdict

- **WHEN** the snapshot is unavailable and a git-visible reviewed input changes while a whole-scope live-fallback review runs
- **THEN** the verdict is discarded, no `PASS` is published, and the error names the changed paths

#### Scenario: Disabled queue fails loud

- **WHEN** the row sets `reviewQueue.enabled` to false
- **THEN** the review step publishes one `config` `ERROR` explaining that reviews run only through the queue, starts no reviewer, and discards any prepared snapshot

### Requirement: Asynchronous review runs

A review SHALL validate its definition, reviewer, and change (and an explicit unit when supplied),
admit the run through the review queue, and return a run id before the reviewer completes. The run MUST
start when the queue admits it, MUST continue in the background, MUST write the digest-bound
`PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST stay visible in the status surface.
Multiple runs MUST proceed concurrently without an engine concurrency cap.

#### Scenario: Review starts and returns

- **WHEN** a review is requested
- **THEN** the call returns a run id and record path after admission, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** several reviews start for different units or changes
- **THEN** the runs proceed concurrently and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails after its retries
- **THEN** an `ERROR` record with the failure class is written and the status reports it

### Requirement: Review queue admission

Every review run SHALL be admitted immediately; the engine MUST NOT enforce a concurrency limit, a
waiting-list cap, or an admission timeout. Identity is the definition, change, unit, prepared digest,
and reviewer: a repeat of a live identity SHALL return the existing run, and a changed digest or
reviewer SHALL be a distinct run. A failed start SHALL retry with bounded backoff and jitter up to
`maxAttempts`; no reviewer SHALL start twice for one identity.

#### Scenario: Capacity is available

- **WHEN** a review is admitted while the provider can start another reviewer
- **THEN** the reviewer starts immediately and the run reports `running`

#### Scenario: Capacity is exhausted

- **WHEN** a review is admitted while many other reviews run
- **THEN** the reviewer still starts immediately, with no waiting position, and the provider's own child limit is the only bound

#### Scenario: Admission timeout

- **WHEN** a review request is admitted
- **THEN** no admission timeout exists and no run waits for a slot; the retired `waitTimeoutMs` value has no effect

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same identity and is requested again
- **THEN** the existing run handle is returned and no second reviewer starts

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same definition and unit but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Failed start retries

- **WHEN** a start fails with a transient class
- **THEN** the run retries with backoff, records the attempt and class, and starts no second reviewer for the identity

### Requirement: Review queue configuration and off switch

The review queue SHALL be configured by `reviewQueue` with `enabled` (default true), `maxAttempts`
(default 3), `baseDelayMs`, and `maxDelayMs`. The retired `concurrency`, `maxQueued`, and
`waitTimeoutMs` fields SHALL be accepted but MUST have no effect. Invalid values MUST fail plugin load
with the field. The engine runs reviews only through the queue, so `enabled: false` SHALL fail the
review step with a `config` `ERROR` and start no reviewer.

#### Scenario: Defaults apply

- **WHEN** the row omits `reviewQueue`
- **THEN** the queue is enabled with the documented retry defaults

#### Scenario: Retired limits are ignored

- **WHEN** the row still sets `concurrency`, `maxQueued`, or `waitTimeoutMs`
- **THEN** the plugin loads and those values have no effect on admission or waiting

#### Scenario: Invalid configuration

- **WHEN** `maxAttempts` is zero or negative
- **THEN** plugin load fails with the field name and the accepted range

#### Scenario: Off switch fails loud

- **WHEN** `reviewQueue.enabled` is false
- **THEN** the review step publishes one `config` `ERROR`, starts no reviewer, and discards any prepared snapshot

### Requirement: Review queue visibility

The status surface SHALL report the active review runs with their attempts and failure class. It MUST
NOT report a queue position or a waiting time, because reviews are admitted immediately. The run
record SHALL carry the same bounded fields. The values MUST be local, MUST NOT contain credentials or
machine paths, and MUST be available to the existing observability surface.

#### Scenario: Status shows the queue

- **WHEN** several reviews run at once
- **THEN** the status reports each active run and its attempt count, with no queue position or waiting time

#### Scenario: Record carries the attempt facts

- **WHEN** a review settles after a retry
- **THEN** its record reports the attempt count and the final failure class when it failed

### Requirement: Stable review inputs

A review MUST review immutable inputs bound to its digest. Every scope SHALL use a detached worktree
snapshot taken when the run starts; the change-artifact digest MUST be computed from the snapshot's
frozen copy. When the snapshot cannot be built, the live fallback MUST track mutations and MUST NOT
publish a `PASS` when any reviewed input changed at any time during the run, including when the content
is later restored. A whole-scope `PASS` whose digest no longer matches the current live digest SHALL be
stale and MUST NOT complete its step.

#### Scenario: Inputs change during a review

- **WHEN** a reviewed input is edited while a snapshot review runs
- **THEN** the verdict is published for the snapshot, no input-change discard happens, and the record is stale against the current inputs

#### Scenario: Edit-read-restore

- **WHEN** a live reviewed file is edited, read by the reviewer, and restored to its original content before a live-fallback run completes
- **THEN** no `PASS` is published for that digest, because the reviewer did not review the digest's contents

#### Scenario: Frozen copy is the digest source

- **WHEN** a change artifact is edited while a task review runs
- **THEN** the run is not discarded and its digest still describes the frozen copy the reviewer read

### Requirement: Reviewed worktree input set

A whole-scope code review MUST take its reviewed worktree inputs from git in its snapshot: tracked
files plus untracked files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two
the worktree digest skips; VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path
the digest covers MUST also be in the snapshot, except the change's `reviews/` approval directory. A
task-scoped review MUST review exactly that set in its snapshot. The live fallback tracks the union
under the mutation guard, so later writes MUST NOT invalidate a snapshot review.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path while a review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while a whole-scope review runs
- **THEN** the snapshot is unaffected and the published record is stale against the current worktree

#### Scenario: Task snapshot carries the same set

- **WHEN** a task review starts with a tracked change, a tracked file matching an ignore rule, an untracked non-ignored file, and ignored output in the worktree
- **THEN** the snapshot contains the tracked change, the tracked-but-ignored file, and the untracked file, not the ignored output

### Requirement: Reviewed change-artifact inputs

A whole-scope review whose digest includes the change-artifact digest MUST freeze the reviewed
change's artifacts in its snapshot, regardless of Git ignore rules, excluding `.openspec.yaml` and the
`reviews/` approval directory; a whole-spec review tracks exactly those artifacts. A task-scoped review
MUST freeze the change directory in its snapshot and compute the digest from that copy; the live
fallback tracks the union.

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** the frozen review publishes, no input-change `ERROR` is written, and the record is stale against the edited artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

#### Scenario: Fallback tracks the union

- **WHEN** the snapshot was unavailable and a change artifact is edited while the fallback task review runs
- **THEN** no `PASS` is published, because the fallback tracks the union of the Git-visible worktree and the change artifacts

### Requirement: Review fallback visibility

When a review of any scope cannot use its frozen snapshot and falls back to the live worktree, the
engine SHALL record a bounded reason on the run while it runs and after it settles, alongside any
verdict or error. When the cause is the missing Git ignore rule for the `.dsh/` scratch directory, the
reason MUST name that cause and the next action.

#### Scenario: Snapshot skipped because `.dsh` is not ignored

- **WHEN** a review cannot build its snapshot because `.dsh/` is not Git-ignored
- **THEN** the run detail says the review is on the live worktree and names the missing `.dsh/` ignore rule and its fix, both while the run is live and after it settles

#### Scenario: Snapshot skipped for another reason

- **WHEN** a review cannot build its snapshot because the repository or change path cannot be resolved, the change lies outside the repository, or the index has unmerged entries
- **THEN** the run detail names that cause in a bounded form and still reports the live-worktree review, including after settlement

### Requirement: Review overlap in the apply loop

The documented apply loop SHALL start a lane review when any task of the lane is checked and SHALL
start every due lane in parallel. It SHALL allow work on another lane while a review runs on a frozen
snapshot; when the run falls back to live worktree inputs, a write invalidates the verdict, so the
guidance MUST require restoring snapshot support or deferring writes until settlement without a
blocking sleep. The waiting close SHALL end the turn for the verdict; the record MUST be collected before the turn
reaches final completion and before archive, so a waiting close is the one intermediate close allowed
while a review is live.

#### Scenario: Parallel lanes proceed

- **WHEN** several lanes have checked tasks without a current `PASS`
- **THEN** the guidance starts every lane review together and permits work on a lane whose review is not running

#### Scenario: Next task proceeds during a snapshot review

- **WHEN** the run reports a frozen snapshot and another lane does not depend on its verdict
- **THEN** the apply guidance permits implementing that lane while the review runs

#### Scenario: Live-worktree fallback

- **WHEN** the run falls back to the live worktree because a review snapshot cannot be built
- **THEN** the apply guidance requires restoring snapshot support and re-running or deferring writes until the run settles, and does not prescribe a blocking sleep

#### Scenario: Guidance ships with the surviving skills

- **WHEN** the apply, propose, or update skill loads the shipped task-lane guidance
- **THEN** the guidance carries the lane-parallel review-at-tick and snapshot/fallback paragraphs and names the `workflows` `note` action for a serial decision, not the removed `task_progress` tool

## MODIFIED Requirements

### Requirement: Owned completion coverage

When the session's tick completes the change's task list, the owned task-review gate SHALL require a portable PASS for every checked task in the change, including tasks this session did not attribute. A missing or `ERROR` record MUST refuse the turn close, except that when every checked task still missing a portable `PASS` has a live review, the close SHALL be allowed as the silent waiting close with no steer and no `VIOLATION`, while completion and the archive remain blocked. Only an intermediate turn that does not complete the list MAY close on `ERROR`.

#### Scenario: Final tick with an unapproved foreign task is refused

- **WHEN** the session's tick completes the task list, an earlier checked task from another session has no portable `PASS`, and that task's review is not live
- **THEN** the turn close is refused and the steer names that task and its review call

#### Scenario: Final tick with an ERROR foreign task is refused

- **WHEN** the session's tick completes the task list and an earlier checked foreign task has only an `ERROR` record with no live review
- **THEN** the turn close is refused because `ERROR` is not a portable `PASS`

#### Scenario: Final tick waits on a live review

- **WHEN** the session's tick completes the task list and every checked task still missing a portable `PASS` has a live review
- **THEN** the turn close is allowed as the silent waiting close with no steer and no `VIOLATION`, completion and the archive stay blocked, and the next round's `PASS` releases completion

#### Scenario: Completed list with PASS coverage closes

- **WHEN** the session's tick completes the task list and every checked task has a portable `PASS`
- **THEN** the turn close is allowed and the archive is ready

### Requirement: Owned work-progress gate

The work-progress gate SHALL be owned by the engine: a code-changing turn SHALL be refused unless it has a newly checked and reviewed task or a `note` action whose worktree digest matches the current worktree. A stale note MUST NOT authorize the close and MUST NOT count as a `PASS`. The note SHALL be written by the `note` action to `.dsh/workflows/notes/<change>.json` and SHALL be readable by any session. The `note` action MUST require the change and the task id and MUST record a bounded reason and a timestamp; it SHALL accept only `in-progress` or `blocked` and MUST reject an unknown task. A checked task SHALL be accepted: a fully checked plan whose remaining work is review has no unchecked task to name, and its matching worktree-digest note is the only available progress evidence; a checked task's note never claims a tick and the task still needs its task-review `PASS` to complete.

#### Scenario: Progress note fields and validation

- **WHEN** a `note` call names a task with status `in-progress` and a reason, whether that task is checked or unchecked
- **THEN** the note records the change, task id, status, reason, timestamp, and current digest
- **AND WHEN** the same call names an unknown task
- **THEN** the note is refused and nothing is written

#### Scenario: Checked task note satisfies an all-checked plan

- **WHEN** a code-changing turn occurs after every task is checked and a note names a checked task with a worktree digest matching the current worktree
- **THEN** the progress gate allows the close, and the ticked task still requires its own task-review `PASS`

#### Scenario: Unchecked task still needs a note

- **WHEN** a code-changing turn leaves its task unchecked and has no matching note
- **THEN** the gate steers to a note or a reviewed tick and the turn does not close for that gate

#### Scenario: Current note allows the close

- **WHEN** a code-changing turn carries a note whose worktree digest matches the current worktree
- **THEN** the gate allows the close and a stale note keeps refusing it


