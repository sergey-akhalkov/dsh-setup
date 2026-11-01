# Spec Delta

## MODIFIED Requirements

### Requirement: Plan work streams

The always-on working contract SHALL state that a multi-file or multi-step task names its
independent lanes with owners and scopes in the plan before the first edit, and refreshes that plan
at each work checkpoint. It SHALL direct a worker per independent lane, or one stated serial form: a
shared scope or a single owner. A single localized fix MUST NOT require this, and the clause MUST
keep the contract within its documented 1500 estimated-token budget.

#### Scenario: Independent streams in the plan

- **WHEN** a multi-file task has independent work streams
- **THEN** the contract directs the plan to name each lane, its owner, and its owned files, and to
  start a worker per independent lane

#### Scenario: Serial reason

- **WHEN** the planned work has no independent streams
- **THEN** the contract directs one stated serial form, a shared scope or a single owner, instead of
  a worker

#### Scenario: Plan refreshed at a checkpoint

- **WHEN** the work reaches a substantial pause or a step interval
- **THEN** the contract directs the checkpoint to refresh the lane plan rather than restate it

#### Scenario: One-line fix

- **WHEN** the task is a single localized fix
- **THEN** the contract does not require a plan or work streams

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget

### Requirement: Work checkpoint guidance

The always-on working contract SHALL state that a substantial pause and each step interval end with
a `work_checkpoint` call carrying the lane plan, the current bottleneck, and the action that removes
it. It SHALL state that computed independent lanes start a worker before the turn closes and that a
shared scope or a single owner is the serial form. The clause MUST stay in the existing section and
within the 1500 estimated-token budget.

#### Scenario: Pause checkpoint

- **WHEN** the assembled contract is read before a substantial pause
- **THEN** it directs a checkpoint call with the lane plan, the verified work, the bottleneck, and
  its remedy

#### Scenario: Parallel lane

- **WHEN** the lane plan computes independent lanes
- **THEN** the contract directs a worker start before closing and keeps integration in the main agent

#### Scenario: Serial reason

- **WHEN** the remaining work is serial
- **THEN** the contract directs the lane plan to express it through a shared scope or a single owner,
  not a serial-reason sentence

#### Scenario: No second section

- **WHEN** the contract is assembled
- **THEN** the guidance is part of the existing working-principles section, not a second always-on
  section

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget

### Requirement: Bottleneck reflection guidance

The always-on working contract SHALL state that the checkpoint names the current bottleneck and that
its remedy must be executed before the turn closes, and that a bottleneck surviving a second
checkpoint requires a route change: a new owner, a changed blocking lane, or a user decision. It
MUST keep the contract within its documented 1500 estimated-token budget.

#### Scenario: Bottleneck named

- **WHEN** the contract is read before a checkpoint
- **THEN** it directs naming the current bottleneck, its owner, and the blocking lanes

#### Scenario: Remedy executed

- **WHEN** the checkpoint names a remedy
- **THEN** the contract directs executing it before the turn closes and states that the plugin checks
  for it

#### Scenario: Aged bottleneck

- **WHEN** the same bottleneck survives a second checkpoint
- **THEN** the contract directs a route change rather than another wait

#### Scenario: Interval request

- **WHEN** the plugin requests a checkpoint at the configured step interval
- **THEN** the contract states that the request applies to a substantial pause and to the interval

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget
