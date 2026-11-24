# Spec Delta

## MODIFIED Requirements

### Requirement: Turn-close gate

When a root turn stops and an active run has an open `blockTurnClose` step that is owned and not deferred, the engine SHALL steer and refuse the close up to `maxBlocks`. After the cap it SHALL allow the close once and record a visible `VIOLATION` that is not a pass. A run that has reached its owned `review` step MUST NOT be released by that budget: while a due review unit has no live review the engine SHALL record no pass and no `VIOLATION` and MUST keep the run open. Every close refusal that has no terminal outcome of its own SHALL be steered under one per-turn delivery bound of `maxBlocks` — a review refusal, a settled verdict, a failed dispatch, the parity-report refusal, and an engine-owned progress or lane refusal: while the bound is not reached the engine SHALL submit the refusal and hold the turn open; once it is reached the engine SHALL submit no further such refusal in that turn, MUST NOT hold the turn for the refusing obligation, and MUST continue evaluating every unrelated obligation (verification, checkpoint, completion, settled verdicts) under its own rules. The checkpoint and run-step obligations keep their own per-turn budget and their own visible `VIOLATION` close, so every close obligation is bounded and no state is held forever. Ending the turn after the bound MUST NOT release, settle, cancel, or close the review run; the next turn SHALL evaluate it again and submit its own bounded refusal. While every due unit has a live review the close SHALL be allowed as a waiting close with no `VIOLATION` and no message. A review run whose recorded change has been archived MUST NOT hold the close: its failed or blocked review is not a due unit. An unresolved run MUST be settled cancelled once instead of being advanced into a review, so it releases its slot without recording a failed attempt; a terminal run MUST stay unchanged. It MUST fail open on an internal error and MUST NOT evaluate a subagent turn.

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

#### Scenario: An owned refusal is bounded per turn

- **WHEN** an engine-owned progress or lane gate refuses the close more than `maxBlocks` times in one turn while the state stays unchanged
- **THEN** exactly `maxBlocks` close-refusal messages are submitted for that turn across every shared-budget site, no later attempt submits one, the turn may end, and every obligation stays due

#### Scenario: A new turn starts a fresh budget

- **WHEN** a later turn changes implementation files again with no coverage
- **THEN** its first close refuses again under a fresh budget and its own bound

#### Scenario: An unchanging turn is not refused by the progress gate

- **WHEN** a later turn changes no implementation file
- **THEN** the progress gate does not refuse the close, while completion and the archive remain governed by the review obligations

#### Scenario: A checkpoint or run-step obligation keeps its own budget

- **WHEN** the shared delivery bound is reached while a checkpoint or a run-step obligation is open
- **THEN** that obligation still applies its own per-turn budget and may allow one close recorded as a visible `VIOLATION`

#### Scenario: The bound is shared across refusal sites

- **WHEN** a review refusal has spent the last unit of a turn's refusal budget
- **THEN** no engine-owned progress or lane refusal is steered in that turn, the turn may end, and nothing is released, settled, approved, or unblocked

### Requirement: Owned work-progress gate

The work-progress gate SHALL be owned by the engine: a code-changing turn SHALL be refused unless it has a newly checked and reviewed task or a `note` action whose worktree digest matches the current worktree. A stale note MUST NOT authorize the close and MUST NOT count as a `PASS`. The note SHALL be written by the `note` action to `.dsh/workflows/notes/<change>.json` and SHALL be readable by any session. The `note` action MUST require the change and the task id and MUST record a bounded reason and a timestamp; it SHALL accept only `in-progress` or `blocked` and MUST reject an unknown task. A checked task SHALL be accepted: a fully checked plan whose remaining work is review has no unchecked task to name, and its matching worktree-digest note is the only available progress evidence; a checked task's note never claims a tick and the task still needs its task-review `PASS` to complete. The refusal SHALL offer only a remedy the plan state allows: it MUST NOT ask for a tick when no unchecked task exists, and its `note` remedy SHALL name the checked task by its 16-character id. The refusal SHALL report the observed state: a missing note MUST be reported as a missing note, the worktree digest SHALL be printed only for a note it is compared with, and an unreadable digest SHALL be named as unreadable. The refusal SHALL be steered under the turn-close delivery bound.

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

#### Scenario: Stale note is rejected

- **WHEN** the worktree digest changes after the note
- **THEN** the gate refuses the close and requires a fresh note or a reviewed tick

#### Scenario: An all-checked plan is steered to a note

- **WHEN** a code-changing turn has no unchecked task and no matching note
- **THEN** the refusal offers only the `note` remedy, names a checked task by its 16-character id, and does not ask for a tick

#### Scenario: A missing note is reported as missing

- **WHEN** no progress note exists for the change at the close
- **THEN** the refusal names the missing note and MUST NOT report the worktree digest as unavailable

#### Scenario: An unreadable digest is named

- **WHEN** a note exists and git cannot produce the current worktree digest
- **THEN** the refusal names the unreadable digest as the cause and offers the retry after the git state is fixed
