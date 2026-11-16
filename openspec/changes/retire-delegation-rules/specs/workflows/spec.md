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

## ADDED Requirements

### Requirement: Review verdict contract

A review SHALL compute the scope digest, run the resolved reviewer with the bundled instruction and the
change, task, and digest context, accept one fenced JSON verdict echoing the digest, and write an atomic
record with the definition, scope, task id when task-scoped, digest, verdict, findings, reviewer
identity, time, and reviewing session. `PASS` MUST require zero P0/P1 findings; a matching
`PASS`/`FINDINGS` record MUST be reused; a stale whole-scope record MUST be ignored.

#### Scenario: Passing review

- **WHEN** the reviewer returns zero P0/P1 findings with the matching digest in the reviewing session
- **THEN** the engine writes a `PASS` record carrying the reviewing session and settles the step from it

#### Scenario: Findings

- **WHEN** the reviewer returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and reports every blocking finding with evidence and fix

#### Scenario: Malformed verdict

- **WHEN** the reviewer returns no single matching verdict, an invalid severity, or prose only
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

### Requirement: Task-scoped review

A task-scoped review SHALL be driven by a checked task, key the record by a stable hash of the
normalized task text, and review an immutable snapshot taken when the run starts, including the frozen
change artifacts. The record MUST remain a historical task snapshot: a write after the run starts and
later tasks MUST NOT invalidate it, and the optional integration review MUST use the current
whole-worktree digest. Fallback to the live worktree MUST keep the mutation guard.

#### Scenario: Checked task reviewed

- **WHEN** a checked task has no matching task-review record
- **THEN** the engine requires a task-scoped review of a snapshot of the task's completion and writes its PASS/ERROR/FINDINGS record

#### Scenario: Later task does not invalidate

- **WHEN** a later task changes the worktree after an earlier task pass
- **THEN** the earlier task record remains historical and the optional integration review covers the current whole worktree

#### Scenario: Write during a task review

- **WHEN** a reviewed file is edited while a task review runs
- **THEN** the run is not discarded, because it reviews a frozen snapshot taken at its start

### Requirement: Explicit task review selection

A task-scoped review call SHALL accept an explicit task id; when present, the engine MUST review that
checked task after validating that it is checked and matches the review definition, instead of
selecting the next checked task. Parallel runs for different tasks MUST NOT collapse onto one task.
When the task id is absent, next-checked-task selection applies. A gate-suggested review MUST name the
explicit task id of the session's checked task.

#### Scenario: Explicit task

- **WHEN** a review names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review runs name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the call is rejected before a reviewer starts and names the allowed checked tasks

### Requirement: Asynchronous review runs

A review SHALL validate its definition, reviewer, and change (and an explicit task when supplied),
admit the run through the review queue, and return a run id before the reviewer completes. The run MUST
start when the queue admits it, MUST continue in the background, MUST write the digest-bound
`PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST stay visible in the status surface.
Multiple runs MUST proceed concurrently up to the configured queue limit.

#### Scenario: Review starts and returns

- **WHEN** a review is requested while the queue has capacity
- **THEN** the call returns a run id and record path after admission, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** several reviews start for different tasks or changes
- **THEN** the runs proceed concurrently up to the configured limit and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails after its retries
- **THEN** an `ERROR` record with the failure class is written and the status reports it

### Requirement: Pending review handling

A duplicate review request MUST be identified by the definition, change, task or phase, prepared
digest, and resolved reviewer. A second request with the same identity while pending MUST return the
existing run handle and MUST NOT start a duplicate; a changed digest or reviewer MUST be a distinct
run.

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same identity and is requested again
- **THEN** the existing run handle is returned and no second reviewer starts

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same definition and task but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Late completion

- **WHEN** a run completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Shared review conversation key

Distinct rules reviewing the same change or task SHALL share one conversation key and execute
serially: a second definition MUST wait for the first even when queue capacity remains. Distinct
definitions MUST queue as separate runs and write their own records, and a late completion MUST NOT
replace the authoritative record.

#### Scenario: Shared conversation key serializes

- **WHEN** two rules review the same task with queue capacity remaining
- **THEN** the second waits for the first and both keep their own records

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same definition and task but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Late completion

- **WHEN** a run completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Review queue admission

Every review run SHALL pass through one per-profile FIFO queue before its reviewer starts. The queue
SHALL enforce a configurable concurrency limit (default 2) and a configurable waiting-list cap (default
16). A run admitted while at capacity waits; a run that cannot be admitted within the wait timeout
SHALL settle as a bounded `ERROR` in its run record and settlement observer, with the queue state, and
no reviewer SHALL start.

#### Scenario: Capacity is available

- **WHEN** a review is admitted while the active count is below the concurrency limit
- **THEN** the reviewer starts and the run reports `running`

#### Scenario: Capacity is exhausted

- **WHEN** a review is admitted while the active count is at the limit and the waiting list has room
- **THEN** the run reports `queued` with its position and starts when a slot frees

#### Scenario: Admission timeout

- **WHEN** the waiting list is full or the wait exceeds `waitTimeoutMs`
- **THEN** the run settles as `ERROR` with `queue-full` or `queue-timeout`, the status and observer report it, and no reviewer starts

### Requirement: Review queue identity and dedupe

An admitted review SHALL be identified by definition, change, task id or phase, digest, provider, and
model. A same-identity request MUST join the existing run; a different digest or definition MUST be a
distinct run. Re-preparation SHALL replace the identity atomically: a free identity keeps the queue
position, an occupied one settles the re-preparing run as `discarded` without a reviewer, and a
discarded key head SHALL promote its next follower.

#### Scenario: Duplicate identity joins

- **WHEN** a second review request has the same identity as a queued or running run
- **THEN** the existing run handle is returned and no duplicate reviewer starts

#### Scenario: Re-preparation collides

- **WHEN** a queued run re-prepares to an identity that already exists
- **THEN** the re-preparing run settles as `discarded` without starting a reviewer and the incumbent remains authoritative

#### Scenario: Different rules stay separate

- **WHEN** two definitions review the same change and task
- **THEN** both runs are queued and each writes its own record

### Requirement: Review failure classification and retry

The queue SHALL classify a failed start or run as transient (`child-limit`, `provider-not-started`,
`timeout`) or permanent (`invalid-output`, `config`, `permission`, `reviewed-inputs-changed`). Transient
classes SHALL retry up to `maxAttempts` (default 3) with bounded exponential backoff and jitter, and a
queued run SHALL re-check its prepared inputs and re-prepare once before starting when they changed. A
permanent class MUST NOT retry.

#### Scenario: Child limit retries

- **WHEN** a start fails with the active-child-limit error
- **THEN** the run waits with backoff, retries, and records the attempt and class

#### Scenario: Queued inputs are re-checked

- **WHEN** a queued run's prepared inputs change before a slot frees
- **THEN** the queue re-prepares once before starting and records the new digest

#### Scenario: In-run input change is terminal

- **WHEN** a run reports that its reviewed inputs changed during the run
- **THEN** it settles as `ERROR` with `reviewed-inputs-changed`, no retry starts, and the gate asks to finish the writes and re-run

### Requirement: Review queue record integrity

A retry MUST NOT create two authoritative records for one identity. Only the settled attempt MAY publish
a verdict; an earlier attempt MUST NOT. A never-started queued run SHALL re-inspect the authoritative
record once start-eligible after its predecessor settles, and use that snapshot as its publication
baseline: a record at that baseline MUST NOT discard its completion, a later record MUST. A superseded
or late completion MUST NOT replace the authoritative record.

#### Scenario: Failed attempt writes no verdict

- **WHEN** an attempt fails with a transient class
- **THEN** no `PASS` or `FINDINGS` record is written for that attempt

#### Scenario: One authoritative record

- **WHEN** a retry succeeds after one or more failed attempts
- **THEN** exactly one record is written for the identity and it carries the settled verdict

#### Scenario: Late duplicate is discarded

- **WHEN** a duplicate run completes after the authoritative record exists
- **THEN** its result is reported as discarded and the record is unchanged

### Requirement: Review queue settlement

The settlement observer SHALL fire exactly once after the run leaves the queue and all retries have
settled, with the run id and terminal state. Queue wait and retry delay are not settlement. An admission
timeout, a permanent failure, and a cancelled run SHALL settle with a recorded terminal state, and the
observer MUST NOT change records, gates, concurrency, or reviewers.

#### Scenario: Queued run settles once

- **WHEN** an observer is supplied and a queued run reaches a terminal state
- **THEN** the observer is called once after the final attempt settles

#### Scenario: Admission timeout settles

- **WHEN** a run cannot be admitted within the timeout
- **THEN** the observer is called once with the timeout terminal state and no record is published as a PASS

#### Scenario: No observer

- **WHEN** no settlement observer is supplied
- **THEN** queueing, retries, records, gates, and status behave exactly as before

### Requirement: Review queue visibility

The status surface SHALL report queue depth, active runs, queued runs, and each run's queue position,
wait time, attempts, and failure class. The run record SHALL carry the same bounded fields. The values
MUST be local, MUST NOT contain credentials or machine paths, and MUST be available to the existing
observability surface.

#### Scenario: Status shows the queue

- **WHEN** one review runs and two wait
- **THEN** the status reports one active, two queued, and each queued run's position

#### Scenario: Record carries the attempt facts

- **WHEN** a review settles after a retry
- **THEN** its record reports the attempt count and the final failure class when it failed

### Requirement: Review queue configuration and off switch

The review queue SHALL be configured by `reviewQueue` with `enabled` (default true), `concurrency`
(default 2), `maxQueued` (default 16), `maxAttempts` (default 3), `baseDelayMs`, `maxDelayMs`, and
`waitTimeoutMs`. Invalid values MUST fail plugin load with the field. The engine runs reviews only
through the queue, so `enabled: false` SHALL fail the review step with a `config` `ERROR` and start no
reviewer.

#### Scenario: Defaults apply

- **WHEN** the row omits `reviewQueue`
- **THEN** the queue is enabled with concurrency 2 and the documented defaults

#### Scenario: Invalid configuration

- **WHEN** `concurrency` is zero or `maxAttempts` is negative
- **THEN** plugin load fails with the field name and the accepted range

#### Scenario: Off switch fails loud

- **WHEN** `reviewQueue.enabled` is false
- **THEN** the review step publishes one `config` `ERROR`, starts no reviewer, and discards any prepared snapshot

### Requirement: Review queue failure isolation

An internal queue error MUST NOT trap the turn or lose the review. The queue SHALL record a bounded
`queue-internal-error`, start the reviewer directly once when a direct start is possible, and otherwise
return an `ERROR` with the next action. The review gate SHALL still evaluate the resulting record, and a
queue error MUST NOT be treated as a `PASS`.

#### Scenario: Internal error falls back

- **WHEN** the queue throws before admission and a direct start is available
- **THEN** the reviewer starts directly, the run records `queue-internal-error`, and the review proceeds

#### Scenario: Gate still evaluates

- **WHEN** a queue failure produces an `ERROR` record
- **THEN** the task and archive gates report the task as unapproved, exactly as for any other `ERROR`

### Requirement: Restart reconciliation

On load, a durable review run with a matching authoritative record SHALL be reconciled to the terminal
state for its verdict, and the record MUST NOT be invalidated by the run-file state or recovery.
Approval SHALL be evaluated only through the existing verdict, scope, digest, and reviewer checks: a
`PASS` approves only when those checks accept it; `FINDINGS` and `ERROR` are preserved but never approve
archive or push. A run with no matching record SHALL be marked interrupted, never a `PASS`.

#### Scenario: Crash after publication

- **WHEN** a run file is left `running` and its authoritative record is a current PASS after a restart
- **THEN** the run is reconciled as completed and the gate treats the task as approved

#### Scenario: Crash before publication

- **WHEN** a run file is left `running` and no authoritative record exists
- **THEN** the run is marked interrupted, no PASS is synthesized, and the gate asks for a fresh review

### Requirement: Stable review inputs

A review MUST review immutable inputs bound to its digest. A task-scoped review SHALL satisfy this with
a detached worktree snapshot taken when the run starts, and its change-artifact digest MUST be computed
from the snapshot's frozen copy. A whole-scope review MUST track mutations over its live inputs and MUST
NOT publish a `PASS` when any reviewed input changed at any time during the run, including when the
content is later restored; a digest re-check alone is not sufficient.

#### Scenario: Inputs change during a review

- **WHEN** a live reviewed input is edited while a whole-scope review runs
- **THEN** no `PASS` is published for that digest and the run reports that the inputs changed

#### Scenario: Edit-read-restore

- **WHEN** a live reviewed file is edited, read by the reviewer, and restored to its original content before the run completes
- **THEN** no `PASS` is published, because the reviewer did not review the digest's contents

#### Scenario: Frozen copy is the digest source

- **WHEN** a change artifact is edited while a task review runs
- **THEN** the run is not discarded and its digest still describes the frozen copy the reviewer read

### Requirement: Reviewed worktree input set

A whole-scope code review MUST take its reviewed worktree inputs from git: tracked files plus untracked
files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest
skips; VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers MUST
also be guarded, except the change's `reviews/` approval directory. A task-scoped review MUST review
exactly that set in its snapshot, so later writes MUST NOT invalidate it.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path while a whole-scope review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while a whole-scope review runs
- **THEN** the change is reported as a changed reviewed input instead of failing the run to read the workspace

#### Scenario: Task snapshot carries the same set

- **WHEN** a task review starts with a tracked change, a tracked file matching an ignore rule, an untracked non-ignored file, and ignored output in the worktree
- **THEN** the snapshot contains the tracked change, the tracked-but-ignored file, and the untracked file, not the ignored output

### Requirement: Reviewed change-artifact inputs

A whole-scope review whose digest includes the change-artifact digest MUST also track the reviewed
change's artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml` and the
`reviews/` approval directory; a whole-spec review tracks exactly those artifacts. A task-scoped review
MUST freeze the change directory in its snapshot and compute the digest from that copy; the live
fallback tracks the union.

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

#### Scenario: Fallback tracks the union

- **WHEN** the snapshot was unavailable and a change artifact is edited while the fallback task review runs
- **THEN** no `PASS` is published, because the fallback tracks the union of the Git-visible worktree and the change artifacts

### Requirement: Reviewed-input change report

When a review is discarded because a reviewed input changed, the reported error MUST name how many
inputs changed, list their paths, state that a write inside the reviewed scope happened during the run,
and give the next action: finish the writes, then re-run the review.

#### Scenario: Discarded verdict explains the change

- **WHEN** a reviewed input changes during a run and the verdict is discarded
- **THEN** the error names the count and paths of the changed inputs and tells the caller to re-run after the writes finish

### Requirement: Task review snapshot

A task-scoped review SHALL review a detached worktree snapshot built from the repository root whose
temporary Git index holds exactly the review input set: tracked paths from the real index (including a
path staged with `git add -f`), plus untracked non-ignored files. The snapshot commit MUST be parented to
`HEAD` when one exists, and building it MUST NOT modify the real index or working tree. When it cannot be
produced, the review MUST fall back to the live worktree under the mutation guard.

#### Scenario: Tracked path matching an ignore rule

- **WHEN** a tracked file matches an ignore rule at the time of a task review
- **THEN** the snapshot contains that file, because tracked membership comes from the real index

#### Scenario: Real index untouched

- **WHEN** the worktree has staged and unstaged changes and a snapshot is built
- **THEN** the real index and working tree are unchanged and the snapshot contains the working-tree content

#### Scenario: Snapshot unavailable

- **WHEN** the repository root, the ignored `.dsh/` scratch directory, or the snapshot commit cannot be used, or the repository has unmerged index entries
- **THEN** the task review reviews the live worktree under the mutation guard instead

### Requirement: Snapshot exclusions

Before the source tree is written, `.dsh/`, `.tmp/`, and the change directory MUST be excluded from the
review input set, so a committed version of any of them cannot enter the snapshot. The change directory
is supplied by the frozen copy.

#### Scenario: Ignored scratch excluded

- **WHEN** the worktree contains ignored files such as `.dsh/`, `node_modules/`, or build output, or an unignored `.tmp/`
- **THEN** the snapshot does not contain those paths

#### Scenario: Committed scratch files excluded

- **WHEN** `.dsh/` or `.tmp/` paths are tracked in the repository
- **THEN** those paths are absent from the input set and from the snapshot

### Requirement: Frozen change artifacts

The change directory MUST be removed from the source tree and copied from the live workspace into the
snapshot after checkout, onto a destination that does not exist in the checkout. That copy MUST be the
source of the task lookup and of the change-artifact digest, so the record describes exactly the
artifacts the reviewer reads. An artifact that matches an ignore rule MUST still be present. When the
change directory lies outside the repository root, the snapshot MUST NOT be used.

#### Scenario: Artifact digest from the frozen copy

- **WHEN** a live artifact is edited after the copy is made and before the digest is computed
- **THEN** the digest describes the captured version, which is what the reviewer reads

#### Scenario: Task lookup in the frozen copy

- **WHEN** the reviewed task is not checked in the frozen `tasks.md`
- **THEN** the run fails with a message naming the change and the task instead of reviewing an inconsistent state

#### Scenario: Change directory outside the repository

- **WHEN** the change directory does not lie inside the repository root
- **THEN** no snapshot is used and the live review runs

### Requirement: Snapshot cleanup on settle

A task review's snapshot worktree, lease, and temporary index MUST be removed when the run settles on
every path, including PASS, FINDINGS, ERROR, timeout, a discarded verdict, and reusing an existing
record. A failed removal MUST NOT change the verdict or record, and the expired lease lets a later sweep
retry it.

#### Scenario: Settle removes the checkout

- **WHEN** a task review publishes a verdict
- **THEN** its snapshot directory, lease, and temporary index are gone

#### Scenario: Reused record removes the checkout

- **WHEN** an existing matching record makes the review return without starting a reviewer
- **THEN** the snapshot and lease created for that attempt are removed

#### Scenario: Removal failure does not change the record

- **WHEN** removing a snapshot fails, for example because a file is locked on Windows
- **THEN** the verdict and record are unchanged, the lease expires, and a later sweep retries the removal

### Requirement: Stale snapshot sweep

A per-workspace sweep MUST run before a snapshot, throttled in time. It MUST remove a snapshot whose
lease has expired, and a snapshot with no lease older than a grace period, and MUST prune stale worktree
metadata. It MUST NOT remove a snapshot with a valid lease, MUST be best-effort, and MUST NOT run a
repository-wide `gc` or `prune`.

#### Scenario: Crash leftover swept

- **WHEN** a snapshot's lease has expired, for example after a crashed or failed Host
- **THEN** a later throttled sweep in that workspace removes it and prunes its stale worktree metadata

#### Scenario: Long review preserved

- **WHEN** a review runs longer than the default timeout and its lease is valid
- **THEN** the sweep leaves its snapshot in place, because ownership is the lease and not a timeout

#### Scenario: No repository-wide prune

- **WHEN** snapshots are cleaned up
- **THEN** the engine runs no `git gc` or `git prune`, because unreachable snapshot objects are content-addressed and collected by the repository's own garbage collection

### Requirement: Review fallback visibility

When a task-scoped review cannot use its frozen snapshot and falls back to the live worktree, the engine
SHALL record a bounded reason on the run while it runs and after it settles, alongside any verdict or
error. When the cause is the missing Git ignore rule for the `.dsh/` scratch directory, the reason MUST
name that cause and the next action.

#### Scenario: Snapshot skipped because `.dsh` is not ignored

- **WHEN** a task review cannot build its snapshot because `.dsh/` is not Git-ignored
- **THEN** the run detail says the review is on the live worktree and names the missing `.dsh/` ignore rule and its fix, both while the run is live and after it settles

#### Scenario: Snapshot skipped for another reason

- **WHEN** a task review cannot build its snapshot because the repository or change path cannot be resolved, the change lies outside the repository, or the index has unmerged entries
- **THEN** the run detail names that cause in a bounded form and still reports the live-worktree review, including after settlement

### Requirement: Section-scoped review

A task review MAY name a section selector: the `tasks.md` level-2 heading number (`1`, `1.x`) or its
normalized title. One run SHALL review all checked tasks in that section in one frozen worktree snapshot
with one prompt and one verdict; unchecked tasks MUST be excluded and never covered. The section selector
and an explicit task id are mutually exclusive.

#### Scenario: Section review covers checked tasks

- **WHEN** a review names section `1` and it has several checked tasks
- **THEN** one run reviews all of them against one snapshot and writes one section verdict

#### Scenario: Unchecked tasks are not covered

- **WHEN** a section contains an unchecked task
- **THEN** the review excludes it and the task remains unapproved and unrecorded

#### Scenario: Task and section are exclusive

- **WHEN** a task-review call names both a task id and a section
- **THEN** the call is rejected before a reviewer starts and names the accepted selectors

### Requirement: Section run identity

The section run identity SHALL include the definition, change, section key, the sorted checked task ids
and texts, the frozen change-artifact digest, and the snapshot content tree; unchanged content MUST
reuse a FINDINGS record. Checking or unchecking a task, or changing a covered task's text, MUST change
the digest and require a new section or task review.

#### Scenario: Unchanged section reuses FINDINGS

- **WHEN** the same section is delegated again with unchanged content and a FINDINGS record exists
- **THEN** that record is reused without another paid run

#### Scenario: Newly checked task needs a new review

- **WHEN** a task is checked after the section PASS
- **THEN** the section digest changes and the task is covered only by a new section or task review

#### Scenario: Changed task text needs a new review

- **WHEN** a covered task's normalized text changes after the section PASS
- **THEN** the digest changes and the task is covered only by a new review

### Requirement: Section gate and status behavior

A section `PASS` SHALL satisfy the turn-stopping and archive checks exactly like a per-task review. While
a section run is queued or running, the gate MUST suggest waiting for its record instead of starting
per-task runs, and the status and review audit MUST count the covered tasks from their portable records.
Section runs MUST respect the review queue identity, dedupe, retry, and settlement rules.

#### Scenario: Gate accepts the covered task

- **WHEN** a section PASS wrote the task's portable approval
- **THEN** the turn gate accepts that checked task and the archive gate reports it approved

#### Scenario: Status reports coverage

- **WHEN** status or the review audit runs after a section PASS
- **THEN** the PASS count includes the covered tasks and the missing list names none of them

### Requirement: Section approval publication

A section `PASS` SHALL publish the existing per-task portable `reviews/<taskId>.json` PASS for every
covered checked task whose current record does not satisfy the approval checks, with the same rule,
verdict, target, time, and digests. A record that satisfies the current approval checks MUST stay
byte-identical; a nonmatching record SHALL be replaced only by the publication transaction, and
unchecked tasks MUST NOT receive a record.

#### Scenario: Missing approvals are published

- **WHEN** a section review returns PASS and its checked tasks have no portable PASS
- **THEN** each covered task gets its per-task portable PASS with the section evidence

#### Scenario: Matching approval is preserved

- **WHEN** a covered task already has a PASS that satisfies the current approval checks
- **THEN** that record stays byte-identical and the section publishes only the remaining records

#### Scenario: Unchecked task is not approved

- **WHEN** a covered unchecked task has no record
- **THEN** the section publishes no record for it

### Requirement: Section publication transaction

A section publication SHALL write all covered records under the existing publication lock, creating
temporaries before any rename. On failure it MUST restore every replaced or removed destination
byte-identically and remove only destinations it created; no approval survives. Overlapping section and
per-task runs MUST serialize: the later discards when an authoritative PASS exists and MUST NOT
overwrite it; a superseded section identity discards the whole publication.

#### Scenario: Partial replacement is rolled back

- **WHEN** a publication fails after replacing one destination that already had a record
- **THEN** the original record is restored byte-identically and no new approval survives

#### Scenario: Section run wins the race

- **WHEN** the section run publishes before an overlapping per-task review
- **THEN** the per-task review discards because an authoritative PASS exists

### Requirement: Section failure visibility

A settled section `ERROR` SHALL be visible to each covered checked task's turn-gate evaluation as an
`ERROR` record with the section's failure class preserved, so an eligible section `ERROR` MAY close the
turn like a task `ERROR`. It MUST publish no new approval: existing valid approvals remain, and the
archive gate reports as missing only covered tasks that lack a valid prior approval.

#### Scenario: Section ERROR closes the turn

- **WHEN** a section review settles ERROR with an eligible failure class
- **THEN** the turn may close with the error visible and no new task approval is granted

#### Scenario: Mixed coverage after ERROR

- **WHEN** one covered task had a valid approval before the section ERROR and another did not
- **THEN** the archive gate keeps the first approved and reports only the second as missing

### Requirement: Session change involvement

The engine SHALL record per DSH session which active OpenSpec changes that session created or modified
under `.dsh/workflows/sessions`, and MUST NOT attribute a change from observation or a workspace diff
alone. Attribution MUST come from write evidence — a successful write or creation tool call targeting
the change during the turn — a successful change-creation command, or an explicit note or review call,
and the state MUST persist across turns and restarts as local scratch.

#### Scenario: No attribution on observation

- **WHEN** a new session opens an active change with checked tasks and no session attribution
- **THEN** it records no involvement and the gate does not steer that change

#### Scenario: Write evidence attributes a change

- **WHEN** a session successfully writes a file under an active change directory during a turn
- **THEN** the next gate records the change as that session's work

#### Scenario: Persistence

- **WHEN** the engine restarts and the same session id resumes
- **THEN** the recorded involvement is reused

### Requirement: Per-write task attribution

A successful `tasks.md` write SHALL attribute only the checkbox transitions caused by that write,
captured from the successful write's canonical before/after contents. It MUST set `specChanged` when
that write's checkbox-normalized before/after contents differ (a substantive task-plan edit or a newly
supplied `tasks.md`); a checkbox-only edit MUST NOT set `specChanged`. The whole-change artifact digest
MUST NOT be used to decide whether a `tasks.md` write was substantive.

#### Scenario: Concurrent task writers

- **WHEN** two sessions check different tasks in the same change during overlapping turns
- **THEN** each session attributes only the task it checked and each gate requires only that task

#### Scenario: Checkbox-only edit

- **WHEN** the only write is changing a task from unchecked to checked
- **THEN** the task is attributed but the change is not marked spec-changed

#### Scenario: Unobservable task write

- **WHEN** a shell write changes `tasks.md` and the engine cannot capture the before/after checkbox state
- **THEN** the change is attributed but no task id is attributed, and an explicit note or a task-review supplies task-level attribution

### Requirement: Session-scoped review triggers

The gated automatic triggers for a change SHALL evaluate only in a session that created or modified that
change. The whole-spec trigger applies only when the session created the change or changed its spec
artifacts; task scope only to tasks the session checked; progress and lane triggers only to an involved
change; the integration trigger only when the session's work completed the list. When the session's tick
completes the list, every checked task MUST have an approved PASS.

#### Scenario: Foreign session not steered

- **WHEN** a session that did not create or modify a change closes a turn while the change has checked tasks without review records
- **THEN** its gate does not steer a review for that change

#### Scenario: Own checked task is gated

- **WHEN** a session checks a task in a change it did not create and the task list is not complete
- **THEN** its gate requires a review for that task and not for checked tasks from other sessions

#### Scenario: Completion requires all checked tasks

- **WHEN** a session's checked task makes the task list fully checked and another checked task has no PASS record
- **THEN** the completing session's gate requires approval for that task too

### Requirement: Cross-session review evidence

Notes and explicit review runs SHALL remain available in any session. An explicit note or review call
MUST attribute that change to the calling session, and a review record MUST name the reviewing session.
A progress note MUST be written for a readable task even when another active change has no readable
`tasks.md`.

#### Scenario: Review from any session

- **WHEN** a session runs a review for a change it did not create or modify
- **THEN** the run starts, the record names the reviewing session, and the change is attributed to that session

#### Scenario: Unreadable foreign change does not block a note

- **WHEN** a note targets a task in a readable change while another active change has no readable tasks.md
- **THEN** the note is written for the readable task and the unreadable change is skipped

### Requirement: Review finding classification

Every review finding SHALL carry a class from the fixed vocabulary `spec-ambiguity`, `missing-test`,
`path-boundary`, `state-persistence`, `stale-input`, `api-contract`, `plan-shape`, `docs-drift`,
`security`, and `other`. The bundled review instructions SHALL request it, and the verdict parser SHALL
store a valid class, normalize an absent or unknown class to `other`, and MUST NOT reject a verdict for
a malformed class.

#### Scenario: Class is stored

- **WHEN** a review returns a finding with class `path-boundary`
- **THEN** the local review record carries that class with the finding

#### Scenario: Unknown class is normalized

- **WHEN** a finding names a class outside the vocabulary
- **THEN** the record stores `other` and the verdict is still accepted

### Requirement: Task lanes and the serial tail

The engine SHALL read lanes from `tasks.md`: a lane MUST be the numbered tasks under the nearest
preceding level-2 heading, a task before the first heading MUST belong to an untitled lane, a lane's
owned paths MUST be the backticked segments of its heading, a lane whose heading contains `serial`
(case-insensitive) MUST NOT count as remaining parallel work, and when no heading contains `serial`
every remaining lane MUST count.

#### Scenario: Serial tail excluded

- **WHEN** the only remaining unchecked tasks are under a heading containing `serial`
- **THEN** the trigger reports nothing

#### Scenario: Change without lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the trigger reports nothing

### Requirement: Lane-assignment fan-out gate

For a change attributed to the current session with at least two non-serial lanes in the plan, the gate
SHALL report unassigned non-serial lanes with unchecked tasks that are not a lane the session ticked in
the turn. A lane is satisfied by a tagged worker start for that lane or by a matching serial note. A
change with exactly one non-serial lane reports nothing, and the gate MUST fail open on an unreadable
plan.

#### Scenario: Unassigned lane on an implementation turn

- **WHEN** a turn that ticked a task or changed implementation files leaves a non-serial lane with unchecked tasks unassigned and outside the lanes ticked that turn
- **THEN** the gate reports the lane with the exact calls

#### Scenario: Completing one lane leaves another

- **WHEN** the turn ticks the last task of lane A, lane B is the only remaining unchecked lane, and the plan has two non-serial lanes
- **THEN** the gate reports lane B

#### Scenario: Another session owns the work

- **WHEN** a different session completed, assigned, or serialized a lane
- **THEN** that evidence does not settle this session's gate

### Requirement: Lane assignment state

The engine SHALL keep a session-scoped assignment for each lane: `assigned` after a successful tagged
worker start, `serial` after a matching note, and current for a lane the session ticked in the turn. An
assignment for a lane that disappears or becomes complete MUST be ignored; a new or renamed lane is
unassigned. A tagged start MUST carry the exact lane tag in the tool arguments.

#### Scenario: Tagged worker assigns one lane

- **WHEN** a successful start contains the `lane-tag` for one lane
- **THEN** only that lane becomes assigned

#### Scenario: Untagged worker does not count

- **WHEN** a successful worker starts without the lane tag
- **THEN** no lane becomes assigned and the gate still reports unassigned lanes

#### Scenario: Renamed lane

- **WHEN** a lane title changes
- **THEN** the old assignment is ignored and the renamed lane is unassigned

### Requirement: Lane-assignment steer payload

The gate MUST steer with each unassigned lane's title, owned paths, a ready worker call carrying
`lane-tag: <change>#<n>`, and a per-lane note call for a serial decision, after a root-anchored
checkpoint commit. The worker call MUST require its own sibling worktree and branch, MUST forbid ticking
`tasks.md`, and the payload MUST NOT contain a machine path.

#### Scenario: Only unassigned lanes are listed

- **WHEN** the gate steers while some lanes are already assigned, serial, current, or complete
- **THEN** the payload lists only the unassigned lanes

#### Scenario: Checkpoint precedes workers

- **WHEN** the gate renders the payload
- **THEN** a commit command appears before the worker calls

#### Scenario: Ignored change directory

- **WHEN** the change directory matches a Git ignore rule
- **THEN** the checkpoint command force-adds that directory before committing

### Requirement: Lane-assignment fail-open

The lane-assignment gate MUST fail open. An unreadable `tasks.md`, a change without level-2 headings, an
unassigned lane without owned paths, and a turn with no implementation change or tick MUST NOT report
the rule. A lane that disappears or becomes complete MUST NOT keep its assignment.

#### Scenario: No lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the gate reports nothing

#### Scenario: Read-only turn

- **WHEN** a turn neither ticked a task nor changed implementation files
- **THEN** the gate reports nothing

### Requirement: Worker-assigned checkpoint lanes

When a task lane is assigned to a tagged worker, a `continue` checkpoint lane covering that work MUST
name an owner other than `lead`, and a bottleneck whose targets fall inside that lane MUST use
`worker_start` or `user_decision`. The gate SHALL steer when the checkpoint lane is missing or
`lead`-owned, or when such a target uses `lead_action`. An unreadable checkpoint or lane plan fails open.

#### Scenario: Worker lane is bound

- **WHEN** a task lane was assigned to a tagged worker and the matching checkpoint lane is owned by a worker
- **THEN** the checkpoint lane passes and the bottleneck owner rule applies to its owner

#### Scenario: Missing assigned lane is refused

- **WHEN** a task lane was assigned to a tagged worker and no checkpoint lane covers it
- **THEN** the turn close is refused and the steer names the missing lane

#### Scenario: Lead action inside a worker lane is refused

- **WHEN** a `continue` bottleneck target falls inside a worker-assigned lane and the action is `lead_action`
- **THEN** the turn close is refused and the steer names `worker_start` or `user_decision`

### Requirement: Plan lane shape in whole-spec review

The bundled whole-spec review instruction SHALL check the plan's work lanes before implementation. It
MUST report a P1 finding when `tasks.md` has more than one level-2 task group and no heading names owned
paths, or when the stated single-lane reason is the review or archive process instead of a work
constraint. The finding MUST name the groups or the reason to change.

#### Scenario: Several groups without owned paths

- **WHEN** a change's `tasks.md` has two or more level-2 task groups and no heading contains a backticked owned path
- **THEN** the whole-spec review reports a P1 finding that names the groups and asks for owned paths or one work-constraint single-lane reason

#### Scenario: Process used as the single-lane reason

- **WHEN** the only stated single-lane reason is the task-review or archive process
- **THEN** the whole-spec review reports a P1 finding and names the work-level reason it needs

### Requirement: Review overlap in the apply loop

The documented apply loop SHALL start a task review as soon as the task is checked. It SHALL allow the
next independent task only when the review runs on a frozen snapshot; when the run falls back to live
worktree inputs, a write invalidates the verdict, so the guidance MUST require restoring snapshot
support and re-running or deferring writes until settlement without a blocking sleep. The record MUST
still be collected before the turn closes and before archive.

#### Scenario: Next task proceeds during a snapshot review

- **WHEN** the run reports a frozen snapshot and another task in the change does not depend on its verdict
- **THEN** the apply guidance permits implementing that task while the review runs

#### Scenario: Live-worktree fallback

- **WHEN** the run falls back to the live worktree because a review snapshot cannot be built
- **THEN** the apply guidance requires restoring snapshot support and re-running or deferring writes until the run settles, and does not prescribe a blocking sleep

#### Scenario: Guidance ships with the surviving skills

- **WHEN** the apply, propose, or update skill loads the shipped task-lane guidance
- **THEN** the guidance carries the review-at-tick and snapshot/fallback paragraphs and names the `workflows` `note` action for a serial decision, not the removed `task_progress` tool

### Requirement: Review trust boundaries

The engine SHALL validate review definition ids, change names, task ids, worktree paths, and git
arguments before effects, MUST use fixed-argument git commands, and MUST keep records and notes free of
credentials, secrets, and machine paths. Reviewer output MUST be treated as untrusted data.

#### Scenario: Invalid rule or change

- **WHEN** a definition id or change name contains a separator, traversal, or unknown directory
- **THEN** the tool rejects it before reading or writing

#### Scenario: Fixed git arguments

- **WHEN** the implementation digest or file list is computed
- **THEN** git runs with fixed arguments and no shell interpolation of model input

#### Scenario: No secrets in records

- **WHEN** a review record is written
- **THEN** it contains no credentials, tokens, machine-specific absolute paths, or private keys

### Requirement: Cataloged external review runs

A review activation on an external provider SHALL start with parent delivery and no explicit child name,
so the subagent service catalogs it as an external child of the delegating Session under the
`delegation:<rule>` label. The child MUST accept no follow-up input, and the parent MUST receive the
settlement notice with the review answer when the run completes.

#### Scenario: External review entry

- **WHEN** a review targets an external provider and the provider publishes the run
- **THEN** the Session's subagent list shows an external entry labelled `delegation:<rule>` with the service-assigned child name, and the entry closes as a leaf when the run settles

#### Scenario: External review notice

- **WHEN** the external review completes
- **THEN** the parent receives the settlement notice with the review answer, while the verdict parser, the record, and every gate behave as before

### Requirement: Provider-specific delivery and catalog behavior

A review activation on an external provider MUST use parent delivery, and the delivery flag only
decides whether the settlement notice is delivered. In-process providers keep the service's existing
behavior: their local children are always cataloged, and continuable children accept follow-up,
independent of the engine's delivery choice.

#### Scenario: Local provider unchanged

- **WHEN** a review target uses an in-process provider
- **THEN** the service catalogs the local child exactly as before (a continuable child accepts follow-up), and the engine's delivery choice only decides whether its settlement notice is delivered

### Requirement: Shipped strong reviewer defaults

The `reviewers.codex` entry SHALL select the shipped strong Codex model with `xhigh` reasoning
effort, and a review step naming `codex` SHALL forward that model and effort; a profile may override
the entry but the shipped default MUST NOT be the weaker model.

#### Scenario: Shipped reviewer defaults

- **WHEN** a review step names the `codex` reviewer with the shipped setup
- **THEN** the provider starts with the strong model and `xhigh` effort

### Requirement: Surviving legacy ownership

Legacy ownership SHALL be resolved per declared signal, not per provider. An `own` definition or step
MUST be refused while its matching legacy signal is enabled; a `defer` definition or step MUST be refused
unless that signal is enabled. The surviving sources are the checkpoint signal (`retro` to
`goal-continuity` `work_checkpoint`, following `checkpoint.automation`) and verification (`verify` to the
`verification-gate` row, following its row configuration and command).

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
- **THEN** the definition is refused with the split-state diagnostic and the setting that MUST be turned off

#### Scenario: Rollback

- **WHEN** the owner re-enables the surviving legacy signal and flips the definition back to `defer`
- **THEN** the legacy signal steers again and the workflow adds no second steer

## REMOVED Requirements

### Requirement: Gate-only switches

**Reason**: The delegation row and its per-signal switches are deleted with the plugin, so no delegation signal remains to enable or disable; the gates that replaced them are owned. The surviving checkpoint and verification legacy sources keep their per-signal ownership check, which is not delegation configuration.

**Migration**: Remove `delegation.gates` from every profile; the engine's `Configuration and off switch` keeps the `enabled` switch. A profile that still sets the deleted row or its gates fails at load with the removed row named.

### Requirement: Per-signal legacy ownership

**Reason**: The requirement resolved ownership for the five delegation signals, which are deleted with the plugin. The generic refusal rule and the checkpoint and verification signals describe plugins that survive, so they move to `Surviving legacy ownership`; the delegation signal clauses and their split-state scenarios are removed with the signal.

**Migration**: `Surviving legacy ownership` keeps the generic `own`/`defer` refusal and the checkpoint (`goal-continuity`) and verification (`verification-gate`) cases; delete only the delegation `legacy`/`ownership` blocks from local definitions and `change-intake`.
