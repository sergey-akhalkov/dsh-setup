# Spec Delta

## MODIFIED Requirements

### Requirement: Turn-close gate

When a root turn stops and an active run has an open `blockTurnClose` step that is owned and not deferred, the engine SHALL steer and refuse the close up to `maxBlocks`. After the cap it SHALL allow the close once and record a visible `VIOLATION` that is not a pass. A run that has reached its owned `review` step MUST NOT be released by that budget: while a due review unit has no live review the engine SHALL record no pass and no `VIOLATION` and MUST keep the run open. Every review refusal shall be steered under one per-turn delivery bound of `maxBlocks`: while the bound is not reached the engine SHALL submit the refusal and hold the turn open; once it is reached the engine SHALL submit no further review refusal in that turn, MUST NOT hold the turn for the review obligation, and MUST continue evaluating every unrelated obligation (verification, checkpoint, completion, settled verdicts) under its own rules. Ending the turn after the bound MUST NOT release, settle, cancel, or close the review run; the next turn SHALL evaluate it again and submit its own bounded refusal. While every due unit has a live review the close SHALL be allowed as a waiting close with no `VIOLATION` and no message. A review run whose recorded change has been archived MUST NOT hold the close: its failed or blocked review is not a due unit. An unresolved run MUST be settled cancelled once instead of being advanced into a review, so it releases its slot without recording a failed attempt; a terminal run MUST stay unchanged. It MUST fail open on an internal error and MUST NOT evaluate a subagent turn.

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
- **THEN** the close is never recorded as a pass or a `VIOLATION` regardless of prior refusals, the run stays open, and a round starts only for a unit whose current digest and coverage are not already settled

#### Scenario: Review refusals are bounded per turn

- **WHEN** the model attempts the close more than `maxBlocks` times in one turn while a due review unit has no live review, a review start keeps failing, a settled verdict stays due, or the review status is unavailable and the owned-review fallback refuses
- **THEN** every attempt leaves the run open, exactly `maxBlocks` review-refusal messages are submitted for that turn across every review-refusal steer site, no later attempt submits a review-refusal message, no `VIOLATION` is recorded for a review obligation, and the turn may end after the bound

#### Scenario: A failed review start stays retryable

- **WHEN** the review refusal bound is reached while the latest review start has failed
- **THEN** the next turn retries the start under a fresh bound, and the failed start still keeps the unit due and the run open

#### Scenario: An unavailable review status is never released

- **WHEN** the owned-review fallback refuses because the review status is unavailable and the bound is reached
- **THEN** the unit stays due, no `VIOLATION` is recorded, the turn may end, and the next turn refuses again under its own bound

#### Scenario: An unrelated obligation still holds the turn

- **WHEN** the review refusal bound is reached while a verification, checkpoint, or completion obligation is also open
- **THEN** the review submits no message but that other obligation is still evaluated and applies its own reference and hold rules

#### Scenario: An ended turn does not release the run

- **WHEN** a turn ends after the review refusal bound with the run still open
- **THEN** the run is unchanged, it is not settled, cancelled, or closed, and the next turn evaluates it again

#### Scenario: A new turn restores the review refusal delivery

- **WHEN** a later turn attempts its first close while a due review unit still has no live review
- **THEN** the refusal text is submitted once again and the close is refused

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

### Requirement: Waiting close for a live review

While every due review unit has a live review run, the turn close SHALL be allowed as a waiting close and MUST NOT submit any steering, follow-up, or injected message to the agent: the turn ends so the asynchronous verdict can start the next one. The close MUST record no `VIOLATION`. Only a current `PASS` SHALL end a unit's obligation; `FINDINGS`, `ERROR`, and a failed start leave it due. A due unit whose current digest and covered task set carry a settled `FINDINGS` or terminal `ERROR` SHALL keep the close unapproved and name the verdict and the explicit fresh-round action; its refusal is steered under the per-turn review delivery bound, and after that bound the turn MAY end while the unit stays due. A run that only has a pending review step with no executor MUST NOT make the waiting close. The close MUST NOT be approved by a refusal budget while a unit is due and no review is live.

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
- **THEN** the unit stays due, the close stays unapproved and the refusal names the findings and the explicit start action, and the next round for the unit starts when the reviewed digest or its coverage moves, or when a fresh round is explicitly requested; no reviewer starts for the unchanged digest

#### Scenario: ERROR is not a pass

- **WHEN** a review settles `ERROR` at the unit's current digest
- **THEN** the unit stays due and unapproved, the close stays unapproved, and no round restarts until the reviewed digest changes or a fresh round is explicitly started

### Requirement: Settled verdict surfacing

A `FINDINGS` or terminal `ERROR` settled at the unit's current digest SHALL keep the unit due and the
close unapproved. The refusal MUST name the verdict, the reviewed digest, the record, and the
explicit fresh-round action, and the close MUST NOT start a reviewer for it. Its delivery SHALL obey
the per-turn review delivery bound: after the bound the turn MAY end while the unit stays due. A run
that only has a pending review step with no executor MUST NOT make the waiting close.

#### Scenario: FINDINGS surfaces with the next action

- **WHEN** the close evaluates a unit settled on `FINDINGS` at its current digest
- **THEN** the close stays unapproved, the text names the verdict, digest, and record, and it offers fixing the findings or starting a fresh round explicitly

#### Scenario: ERROR surfaces with its failure class

- **WHEN** the close evaluates a unit settled on a terminal `ERROR` at its current digest
- **THEN** the close stays unapproved and the text names the failure class and the explicit fresh-round action

#### Scenario: A blocked run is not live coverage

- **WHEN** a review run's review step is pending and no executor holds it and it waits on no live covering review
- **THEN** the close does not treat that run as a live review and does not become a silent waiting close because of it

#### Scenario: A foreign verdict refuses the close without a local run

- **WHEN** another session published the settled non-`PASS` verdict and this session's close owns no review run for the unit
- **THEN** the close stays unapproved with the verdict, digest, record, and explicit action, and no reviewer starts

#### Scenario: A settled verdict starts no reviewer

- **WHEN** the close evaluated a unit settled at its current digest
- **THEN** no reviewer child starts for that unit until the digest or coverage changes or a fresh round is explicitly requested

### Requirement: Owned completion coverage

When the session's tick completes the change's task list, the owned task-review gate SHALL require a portable PASS for every checked task in the change, including tasks this session did not attribute. A missing or `ERROR` record MUST keep completion and the archive blocked and the close unapproved, except that when every checked task still missing a portable `PASS` has a live review, the close SHALL be allowed as the silent waiting close with no steer and no `VIOLATION`, while completion and the archive remain blocked. Its refusal delivery SHALL obey the per-turn review delivery bound, after which the turn MAY end with completion still blocked. Only an intermediate turn that does not complete the list MAY close on `ERROR`.

#### Scenario: Final tick with an unapproved foreign task is refused

- **WHEN** the session's tick completes the task list, an earlier checked task from another session has no portable `PASS`, and that task's review is not live
- **THEN** the close stays unapproved and the steer names that task and its review call

#### Scenario: Final tick with an ERROR foreign task is refused

- **WHEN** the session's tick completes the task list and an earlier checked foreign task has only an `ERROR` record with no live review
- **THEN** the close stays unapproved because `ERROR` is not a portable `PASS`

#### Scenario: Final tick waits on a live review

- **WHEN** the session's tick completes the task list and every checked task still missing a portable `PASS` has a live review
- **THEN** the turn close is allowed as the silent waiting close with no steer and no `VIOLATION`, completion and the archive stay blocked, and the next round's `PASS` releases completion

#### Scenario: Completed list with PASS coverage closes

- **WHEN** the session's tick completes the task list and every checked task has a portable `PASS`
- **THEN** the turn close is allowed and the archive is ready
