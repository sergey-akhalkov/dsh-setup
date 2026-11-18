# Spec Delta

## ADDED Requirements

### Requirement: Inactive change is not involved

A change is involved only while an active change exists under `openspec/changes/`. When a session's
persisted involvement names a change that is archived or deleted, the engine MUST NOT treat that
change as involved: the turn close MUST start no conditional definition for it. The persisted record
MAY stay on disk, MUST be ignored, and MUST NOT require manual cleanup.

#### Scenario: Archived change is ignored at the close

- **WHEN** a session's persisted involvement names a change that has been archived and the turn stops
- **THEN** the close starts no whole-spec or integration review for that change and records no review obligation for it

#### Scenario: Missing change is ignored

- **WHEN** the stored involvement names a change that does not exist under `openspec/changes/`
- **THEN** the close treats the session as uninvolved in it

#### Scenario: No manual cleanup

- **WHEN** an archived change's name is still in the involvement record
- **THEN** the engine ignores it without any edit to `.dsh`, and an active change named by the same record still evaluates normally

### Requirement: Late review publication is discarded

A committed approval MUST be written only while its change is an active change under
`openspec/changes/`. A verdict that lands after the change left the active tree MUST be discarded: the
engine MUST NOT write the approval and MUST NOT create the change directory or any missing ancestor,
and the attempt is recorded as an error rather than a PASS.

#### Scenario: A late PASS does not recreate the archived change

- **WHEN** a reviewer publishes PASS after its change was archived
- **THEN** no approval file is written and `openspec/changes/<change>/` is not recreated

#### Scenario: An active change keeps publishing

- **WHEN** the change is active under `openspec/changes/`
- **THEN** the committed approval is written as before

## MODIFIED Requirements

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
- **THEN** the close is refused regardless of prior refusals, the next round starts, and no `VIOLATION` is recorded for the review

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
