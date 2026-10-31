# Spec Delta

## ADDED Requirements

### Requirement: Plan work streams

The always-on working contract SHALL state that a multi-file or multi-step task names its
independent work streams and their owned files in the written plan before the first edit. It SHALL
direct a worker per independent stream, or one stated reason why the work is serial. A single
localized fix MUST NOT require this, and the clause MUST keep the contract within its documented
1500 estimated-token budget.

#### Scenario: Independent streams in the plan

- **WHEN** a multi-file task has independent work streams
- **THEN** the contract directs the plan to name each stream and its owned files and to start a
  worker per independent stream

#### Scenario: Serial reason

- **WHEN** the planned work has no independent streams
- **THEN** the contract directs one stated serial reason instead of a worker

#### Scenario: One-line fix

- **WHEN** the task is a single localized fix
- **THEN** the contract does not require a plan or work streams

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget

### Requirement: Bottleneck reflection guidance

The always-on working contract SHALL state that each work checkpoint names the current bottleneck
and the next action that removes it, in addition to the lane decision, and that the plugin requests
a checkpoint at each configured step interval. It MUST keep the contract within its documented 1500
estimated-token budget.

#### Scenario: Bottleneck named

- **WHEN** the contract is read before a checkpoint
- **THEN** it directs naming the current bottleneck and the next action that removes it

#### Scenario: Interval request

- **WHEN** the plugin requests a checkpoint at the configured step interval
- **THEN** the contract states that the request applies to a substantial pause and to the interval

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1500 estimated-token budget
