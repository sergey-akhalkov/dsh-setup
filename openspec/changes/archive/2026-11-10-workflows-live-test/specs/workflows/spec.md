# Spec Delta

## MODIFIED Requirements

### Requirement: Owned verification

The `verify` definition SHALL reproduce the verification gate: after a code-writing turn,
it SHALL require a foreground zero-exit result for the configured commands after the last
write, and refuse the close until that result exists. The definition MUST NOT execute the
command; the agent runs it. In the migrated setup, the legacy `verification-gate` row MUST
be disabled and MUST NOT steer. A profile that configures an empty `commands` list SHALL keep
the definition inert: the step records `no-command` evidence and the turn close is allowed
without a verification steer.

#### Scenario: Check is required

- **WHEN** a turn wrote code and the verify definition is active
- **THEN** the close is refused until the configured command exits zero after the last write

#### Scenario: Command is not executed by the gate

- **WHEN** the definition names a command
- **THEN** the definition does not execute it; the agent runs it and the workflow reads the result

#### Scenario: Legacy row is silent

- **WHEN** the verification-gate row is disabled
- **THEN** it produces no steer and the workflow is the only gate

#### Scenario: No configured command keeps it inert

- **WHEN** a profile configures `verify.commands` as an empty list and a turn writes code
- **THEN** the step records `no-command` evidence, the close is allowed, and no verification
  steer is added
