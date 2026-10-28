# Spec Delta

## ADDED Requirements

### Requirement: Machine-readable abort cause

The guard's hook cancellation reason SHALL begin with `loop-guard:reset:` for a turn reset and with `loop-guard:final:` for the final stop, followed by the existing human-readable reason. The prefix contract MUST NOT alter detection, escalation, notices, limits, or the human-readable text.

#### Scenario: Reset cause is identifiable

- **WHEN** a turn is reset at the step-end boundary
- **THEN** the durable turn-end reason begins with `loop-guard:reset:` and still names the repeated line and the limits

#### Scenario: Final stop cause is identifiable

- **WHEN** the configured reset limit is reached and the loop persists
- **THEN** the durable turn-end reason begins with `loop-guard:final:` and still names the repeated line and the limits

#### Scenario: Own-reset recognition is preserved

- **WHEN** the guard observes its own hook cancellation
- **THEN** the reset flow still recognizes it and the follow-up reset notice is allowed
