# Spec Delta

## ADDED Requirements

### Requirement: Goal-round wait handling

The always-on working contract SHALL state that a goal round MUST NOT end only to wait for background work: the agent SHALL use `job_output(wait: true)` or do independent work in the same round. A timeout MUST NOT be treated as a blocker; the same job handle is rechecked.

#### Scenario: Pending background job

- **WHEN** a goal round has a pending background job
- **THEN** the assembled contract directs the agent to wait with `job_output(wait: true)` or to do independent work instead of ending the round

#### Scenario: Timeout is not a blocker

- **WHEN** a job observation times out
- **THEN** the contract directs the agent to recheck the same handle rather than report a blocker

### Requirement: Goal blocker and completion evidence

The always-on working contract SHALL state that `blocked` requires three consecutive goal rounds with the same checkable obstacle, that difficulty, uncertainty and remaining work are not blockers, and that `complete` requires current evidence for every requirement of the objective.

#### Scenario: Premature blocker

- **WHEN** the agent considers reporting `blocked` before three consecutive rounds or with a changed obstacle
- **THEN** the contract rejects that report and keeps the goal active

#### Scenario: Completion audit

- **WHEN** the agent considers reporting `complete`
- **THEN** the contract requires each requirement of the objective to be checked against current evidence

### Requirement: Goal round-cap discipline

The always-on working contract SHALL state that goal creation omits `max_goal_rounds` unless the user explicitly asked for a round limit, so the deployment default governs the budget.

#### Scenario: Default budget

- **WHEN** a goal is created without a user-requested round limit
- **THEN** the contract omits `max_goal_rounds` and the deployment default applies

#### Scenario: Explicit limit

- **WHEN** the user explicitly asks for a round limit
- **THEN** the contract passes that limit

### Requirement: Goal guidance stays in the bounded contract

The goal guidance SHALL be part of the existing working-principles always-on section, not a second section, and the contract MUST remain within its documented 1500 estimated-token budget.

#### Scenario: Single bounded section

- **WHEN** the contract is assembled and repository validation measures it
- **THEN** the goal guidance appears in the working-principles section and the measured size stays within the documented budget
