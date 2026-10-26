# Spec Delta

## ADDED Requirements

### Requirement: Delegation guidance

The always-on working contract SHALL state that one agent with its on-demand skills is the default, and SHALL name the conditions for handing work to a subagent or teammate: an independent piece with little shared context that runs in parallel and returns a compact result, or verification that needs a fresh context. The contract MUST NOT require a team or subagent for sequential or shared-context work.

#### Scenario: Default single loop

- **WHEN** a session starts with the working-principles row active with default configuration
- **THEN** the assembled prompt states the single-agent default and the delegation conditions

#### Scenario: Independent parallel piece

- **WHEN** a piece is independent, can run in parallel, and returns a compact result
- **THEN** the guidance permits a subagent or teammate for that piece

#### Scenario: Sequential work

- **WHEN** the work is sequential or shares evolving context
- **THEN** the guidance does not require a team or subagent and keeps the work in the main loop

#### Scenario: Single section

- **WHEN** the contract is assembled
- **THEN** the delegation guidance is part of the existing working-principles section, not a second always-on section
