# Spec Delta

## ADDED Requirements

### Requirement: Loop-guard reset stops continuation

A goal round that ends on a `loop-guard:reset` hook cause MUST NOT resume the goal, even when the checkpoint-evidenced and no-effect continuation rules would permit it. After the disarm that prevents a recorded pause, the supervisor SHALL deliver one bounded notice naming the reset and the recovery. The goal MUST stay `active`; only a later direct user message or an explicit `/goal resume` continues it.

#### Scenario: Guard reset is not continued

- **WHEN** a goal round is aborted by a `loop-guard:reset` hook cause, the goal is active and disarmed, and no continuation rule stops it
- **THEN** the supervisor resumes nothing, records one notice naming the reset, and leaves the goal active

#### Scenario: Reset at the cap extends nothing

- **WHEN** a reset leaves an active disarmed goal at its round cap
- **THEN** the supervisor extends no cap, resumes nothing, leaves the phase active, and its notice names the cap as the prerequisite for an explicit resume

#### Scenario: A user signal continues the goal

- **WHEN** the user sends a direct message after a reset stop
- **THEN** the suppression clears and the ordinary continuation rules apply, including the capped-goal extension

#### Scenario: Paused goal is never resumed

- **WHEN** the goal is paused
- **THEN** the supervisor does not resume it

### Requirement: An earlier stop keeps its own notice

When the continuation decision for a reset-aborted round already stopped it, the supervisor MUST keep that cause, its suppression, and its single notice, and MUST NOT add a reset notice or replace the cause.

#### Scenario: Evidence keeps its own notice

- **WHEN** a goal round is aborted by a reset and the preceding continuation decision already stopped it with a plan or no-effect notice
- **THEN** the existing suppression and its single notice stay, and no reset notice is added

## MODIFIED Requirements

### Requirement: Reset at the round cap

When an active disarmed goal has `roundsStarted` at or above `maxGoalRounds` and no continuation rule stops it — for example after a direct user message cleared a reset stop — the supervisor SHALL extend `maxGoalRounds` by the configured extension under the per-goal extension budget before resuming. At the reset itself the reset stop is a continuation rule, so no extension happens and the notice names the cap as the prerequisite for `/goal resume`. When no continuation rule stops it and the extension budget or the hard total cap is exhausted, it MUST NOT resume and SHALL block the goal with `continuity-stopped` and a bounded reason.

#### Scenario: Reset on the last permitted round

- **WHEN** a direct user message cleared a reset stop and the capped active disarmed goal is reconciled with extension budget available
- **THEN** the supervisor extends the cap, resumes the goal, and records one notice

#### Scenario: Withheld reset extends no cap

- **WHEN** a reset leaves an active disarmed goal at or above its round cap
- **THEN** the supervisor extends no cap, resumes nothing, leaves the phase active, and records one notice naming the reset

#### Scenario: No extension capacity at the cap

- **WHEN** a capped unsuppressed active disarmed goal has no extension budget or no hard-cap room left
- **THEN** the supervisor resumes nothing and blocks the goal with `continuity-stopped` and the reason

## REMOVED Requirements

### Requirement: Recoverable reset continuation

**Reason**: A `loop-guard:reset` means the loop guard stopped a repeated reasoning line, so the model that would continue the goal is still looping; resuming re-arms automatic work on a broken model, as recorded in session `session-ea02b074` (automatic resumes 1 and 2 of 20 during a loop). The pause prevention, the evidence stops, and the generic capped-goal extension already handle the recoverable cases without a reset resume.

**Migration**: No configuration change. After a reset the goal stays active and disarmed; send a message or run `/goal resume` to continue it.
