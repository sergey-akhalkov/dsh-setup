# Spec Delta

## ADDED Requirements

### Requirement: Review round settlement

A review verdict SHALL settle its unit at the digest it reviewed: the publishing run records the
verdict on its review step, and the engine MUST NOT start another reviewer for that unit while the
unit's reviewed digest and covered checked-task set still match the verdict's. A matching digest
`PASS` MUST NOT be re-reviewed. A settled verdict is not liveness.

#### Scenario: A lane verdict is historical

- **WHEN** a later write changes the worktree after a task or section verdict was published
- **THEN** the verdict still settles the unit at the digest its publishing run recorded, and only a changed covered checked-task set, a changed task text, or an explicit fresh round makes the unit due again

#### Scenario: Verdict settles its unit

- **WHEN** a review returns `FINDINGS` for the unit's current digest
- **THEN** the run records the verdict with its record path and digest, and no reviewer starts for that unit while the digest and the covered task set are unchanged

#### Scenario: Matching PASS is not re-reviewed

- **WHEN** the unit's current digest and coverage carry a `PASS` record that the step's contract accepts
- **THEN** the step settles from that record and no reviewer starts

#### Scenario: Section PASS reuses its covered approvals

- **WHEN** a section `PASS` record covers the unit's checked tasks and every covered task's committed portable approval matches
- **THEN** the step settles from the record without a new reviewer, and the check never requires an approval keyed by the section record id

#### Scenario: A settled verdict covers every session

- **WHEN** the settled verdict was published by another session's run
- **THEN** it settles the unit in the same way and no session starts a second reviewer for it

#### Scenario: A fallback record settles its run

- **WHEN** snapshot creation failed and the run published a `FINDINGS` or `PASS` record at its fallback digest
- **THEN** the next close settles the step from that record and starts no reviewer while the recorded digest and coverage are unchanged

#### Scenario: A later write keeps a task PASS historical

- **WHEN** a later task changes the worktree after an earlier task's `PASS`
- **THEN** the earlier `PASS` stays accepted as historical coverage, starts no round on its own, and the optional integration review covers the current worktree

### Requirement: Review round restart eligibility

A fresh review round SHALL be eligible only when a whole-scope unit's live reviewed digest differs
from the settled verdict's digest, the unit's covered checked-task set or task text changed, or a
`workflows start` explicitly requests that unit. A historical task or section `PASS` MUST NOT become
due because a later write changed the worktree. An attempt that ended without a verdict — interrupted
by a host restart, cancelled, or a failed start — MUST NOT count as a settled round.

#### Scenario: Changed whole-scope digest starts one round

- **WHEN** a whole-scope unit's reviewed worktree or change artifacts change after a settled verdict
- **THEN** the next close starts exactly one round for the unit at the new digest

#### Scenario: Changed coverage starts one round

- **WHEN** a checked task is added to a section unit after its settled verdict without changing the change-artifact digest
- **THEN** the unit is reviewed again because its covered task set changed

#### Scenario: Explicit start begins a fresh round

- **WHEN** a user or the model calls `workflows start` for a settled unit
- **THEN** one round starts for that unit and no automatic path is required

#### Scenario: An explicit start settles after its verdict

- **WHEN** an explicit `workflows start` publishes its verdict and the turn closes again without another explicit request
- **THEN** the normal settlement applies: no reviewer starts, and a non-`PASS` verdict refuses the close with its diagnostic

#### Scenario: Verdict-less attempt is not settled

- **WHEN** a review run was interrupted, cancelled, or failed to start before any verdict
- **THEN** its unit stays eligible and the next close starts one fresh round, superseding the predecessor as the restart rule already requires

### Requirement: Settled verdict surfacing

A `FINDINGS` or terminal `ERROR` settled at the unit's current digest SHALL keep the unit due and the
turn close refused. The refusal MUST name the verdict, the reviewed digest, the record, and the
explicit fresh-round action, and the close MUST NOT start a reviewer for it. A run that only has a
pending review step with no executor MUST NOT make the waiting close.

#### Scenario: FINDINGS surfaces with the next action

- **WHEN** the close evaluates a unit settled on `FINDINGS` at its current digest
- **THEN** the close is refused, the text names the verdict, digest, and record, and it offers fixing the findings or starting a fresh round explicitly

#### Scenario: ERROR surfaces with its failure class

- **WHEN** the close evaluates a unit settled on a terminal `ERROR` at its current digest
- **THEN** the close is refused and the text names the failure class and the explicit fresh-round action

#### Scenario: A blocked run is not live coverage

- **WHEN** a review run's review step is pending and no executor holds it and it waits on no live covering review
- **THEN** the close does not treat that run as a live review and does not become a silent waiting close because of it

#### Scenario: A foreign verdict refuses the close without a local run

- **WHEN** another session published the settled non-`PASS` verdict and this session's close owns no review run for the unit
- **THEN** the close is still refused with the verdict, digest, record, and explicit action, and no reviewer starts

#### Scenario: A settled verdict starts no reviewer

- **WHEN** the close refused a unit settled at its current digest
- **THEN** no reviewer child starts for that unit until the digest or coverage changes or a fresh round is explicitly requested

## MODIFIED Requirements

### Requirement: Review verdict contract

A review SHALL compute the scope digest, run the resolved reviewer with the bundled instruction and the
change, task, and digest context, accept one fenced JSON verdict echoing the digest, and write an atomic
record with the definition, scope, task id when task-scoped, digest, verdict, findings, reviewer
identity, time, and reviewing session. `PASS` MUST require zero P0/P1 findings; a matching
`PASS`/`FINDINGS`/`ERROR` record at the round's recorded digest MUST be reused instead of starting a
reviewer, and a stale whole-scope record MUST be ignored. Only an `ERROR` whose attempt produced
unusable output is terminal; a start, transport, or discarded-input failure carries no verdict and is
retried.

#### Scenario: Passing review

- **WHEN** the reviewer returns zero P0/P1 findings with the matching digest in the reviewing session
- **THEN** the engine writes a `PASS` record carrying the reviewing session and settles the step from it

#### Scenario: Findings

- **WHEN** the reviewer returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and reports every blocking finding with evidence and fix

#### Scenario: Malformed verdict

- **WHEN** the reviewer returns no single matching verdict, an invalid severity, or prose only
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

#### Scenario: Matching verdict is reused

- **WHEN** the unit's record already holds a `PASS`, `FINDINGS`, or terminal `ERROR` at the current digest
- **THEN** that verdict is reused and no second reviewer starts for the same snapshot

### Requirement: Waiting close for a live review

While every due review unit has a live review run, the turn close SHALL be allowed as a waiting
close and MUST NOT submit any steering, follow-up, or injected message to the agent: the turn ends so
the asynchronous verdict can start the next one. The close MUST record no `VIOLATION`. Only a current
`PASS` SHALL end a unit's obligation; `FINDINGS`, `ERROR`, and a failed start leave it due. A due unit
whose current digest and covered task set carry a settled `FINDINGS` or terminal `ERROR` SHALL keep
the close refused and name the verdict and the explicit fresh-round action. A run that only has a
pending review step with no executor MUST NOT make the waiting close. The close MUST NOT be released
by a refusal budget while a unit is due and no review is live.

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

- **WHEN** a review settles `FINDINGS` at the unit's current digest
- **THEN** the unit stays due, the close is refused naming the findings and the explicit start action, and the next round for the unit starts when the reviewed digest or its coverage moves, or when a fresh round is explicitly requested; no reviewer starts for the unchanged digest

#### Scenario: ERROR is not a pass

- **WHEN** a review settles `ERROR` at the unit's current digest
- **THEN** the unit stays due and unapproved, the close is refused, and no round restarts until the reviewed digest changes or a fresh round is explicitly started

### Requirement: Turn-close gate

When a root turn stops and an active run has an open `blockTurnClose` step that is owned and not deferred, the engine SHALL steer and refuse the close up to `maxBlocks`. After the cap it SHALL allow the close once and record a visible `VIOLATION` that is not a pass. A run that has reached its owned `review` step MUST NOT be released by that budget: while a due review unit has no live review the close SHALL be refused, and while every due unit has a live review it SHALL be allowed as a waiting close with no `VIOLATION` and no message. A review run whose recorded change has been archived MUST NOT hold the close: its failed or blocked review is not a due unit. An unresolved run MUST be settled cancelled once instead of being advanced into a review, so it releases its slot without recording a failed attempt; a terminal run MUST stay unchanged. It MUST fail open on an internal error and MUST NOT evaluate a subagent turn.

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
- **THEN** the close is refused regardless of prior refusals, no `VIOLATION` is recorded for the review, and a round starts only for a unit whose current digest and coverage are not already settled

#### Scenario: An archived change's run does not hold the close

- **WHEN** an open review run's recorded change has been archived at the turn stop
- **THEN** the close is evaluated without that run and is not refused for it

#### Scenario: An archived review run is settled cancelled once

- **WHEN** a stored unresolved review run's recorded change is archived at the turn stop
- **THEN** no review round starts, the close is not refused for it, the run is cancelled with a reason, and a later close leaves it unchanged

#### Scenario: A date-prefixed entry is the dated layout

- **WHEN** a change's own name starts with a date and its entry in the archive collection carries no date prefix
- **THEN** the entry is read as the dated layout of its suffix, the original name is not treated as archived, and its review keeps refusing until the entry carries a date

#### Scenario: A terminal archived review run is unchanged

- **WHEN** the stored review run's recorded change is archived and the run is already terminal
- **THEN** the run is not rewritten and its stored file stays byte-identical

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
