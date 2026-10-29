# Spec Delta

## ADDED Requirements

### Requirement: Plan checkpoint guidance

The always-on working contract SHALL state that a request which touches more than one file, or whose cause is not yet known, gets a written plan and the user's nod before the first edit, and that a one-line fix needs none. It MUST NOT claim a command or mode the Harness does not provide, and the clause MUST keep the contract within its documented budget.

#### Scenario: Multi-file request

- **WHEN** the assembled contract is read before a request that spans several files
- **THEN** it directs the agent to write the plan and wait for approval before editing

#### Scenario: One-line fix

- **WHEN** the request is a single localized fix
- **THEN** the contract does not require a plan

#### Scenario: Plan mode belongs to the user

- **WHEN** the user has plan mode enabled
- **THEN** the contract directs the agent not to edit while it is active and names no way to enter or leave it

#### Scenario: Budget preserved

- **WHEN** repository validation measures the working contract
- **THEN** the measured size stays within the documented 1,500 estimated-token budget

### Requirement: Second-mistake rule

The `verify-change` skill SHALL state that a correction needed twice is a durable gap and MUST direct the agent to propose the durable fix — an edit to the workspace instruction file or a hook — naming which one, instead of promising more care.

#### Scenario: Repeated correction

- **WHEN** the agent notices that the same correction was applied twice in a session
- **THEN** the skill directs it to propose the instruction-file edit or the hook and name the choice

#### Scenario: A single correction

- **WHEN** a correction happened once
- **THEN** the skill does not require a durable change

### Requirement: Workspace instruction budget

The repository's workspace instruction file SHALL NOT exceed a documented budget of 16,000 bytes, roughly 4,000 estimated tokens at the repository's bytes-per-four convention, and `validate:repo` MUST fail above that budget, reporting the owning file and the measured size. The `instruction-budget` skill SHALL report a workspace instruction file against the same budget and MUST propose moving detail out instead of deleting it.

#### Scenario: Within budget

- **WHEN** `validate:repo` runs with the workspace instruction file at or below the budget
- **THEN** the check passes and the documentation states the budget and the measured size

#### Scenario: Over budget

- **WHEN** the workspace instruction file grows past the budget
- **THEN** `validate:repo` fails and names the file and the measured size

#### Scenario: Audit reports duplication

- **WHEN** the `instruction-budget` skill is invoked for a workspace instruction file
- **THEN** it reports the measured size against the budget and lists the lines that duplicate the repository, its documentation, or its architecture

#### Scenario: Audit moves instead of deleting

- **WHEN** the audit proposes removing a line that carries a fact found nowhere else
- **THEN** it proposes the destination that will hold the fact and moves it there

#### Scenario: Catalog entry only

- **WHEN** the session starts without invoking `instruction-budget`
- **THEN** the catalog advertises its description and its body is absent from the assembled prompt
