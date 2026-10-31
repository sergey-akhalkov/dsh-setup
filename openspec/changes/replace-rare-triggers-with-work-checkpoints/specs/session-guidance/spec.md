# Spec Delta

## ADDED Requirements

### Requirement: Goal as the work unit

The always-on working contract SHALL state that a multi-step task runs under an active goal: the agent creates a goal before the first step and treats each pause as a goal round. A single-turn, one-line, or purely informational request MUST NOT create a goal. The clause MUST stay in the existing working-principles section and within its documented 1500 estimated-token budget.

#### Scenario: Multi-step task

- **WHEN** a request needs more than one working turn
- **THEN** the contract directs the agent to create a goal before the first step

#### Scenario: Single-turn request

- **WHEN** the request is a one-line fix or an informational answer
- **THEN** the contract does not require a goal

#### Scenario: Pause is a goal round

- **WHEN** a goal round ends
- **THEN** the contract treats the pause as a goal round rather than a silent stop

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget

### Requirement: Work checkpoint guidance

The always-on working contract SHALL state that a substantial pause ends with a `work_checkpoint` call covering whether the work is done, what is verified, what remains, and whether the remainder has independent parallel lanes. It SHALL state that a parallel declaration starts a worker for at least one lane before the turn closes, and that serial work names its reason. The clause MUST stay in the existing section and within the 1500 estimated-token budget.

#### Scenario: Pause checkpoint

- **WHEN** the assembled contract is read before a substantial pause
- **THEN** it directs a checkpoint call with the done, verified, remaining, and parallel decisions

#### Scenario: Parallel lane

- **WHEN** the remaining work has independent lanes
- **THEN** the contract directs a worker start before closing and keeps integration in the main agent

#### Scenario: Serial reason

- **WHEN** the remaining work is serial
- **THEN** the contract directs the checkpoint serial reason

#### Scenario: No second section

- **WHEN** the contract is assembled
- **THEN** the guidance is part of the existing working-principles section, not a second always-on section

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget
