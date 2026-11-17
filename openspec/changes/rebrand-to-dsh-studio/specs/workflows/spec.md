# Spec Delta

## MODIFIED Requirements

### Requirement: Installed definitions

The engine SHALL ship the built-in process definitions: `task-review`, `spec-review`,
`integration-review`, `retro`, and `verify`. The review definitions declare `own` and resolve their
effective ownership from the matching legacy switch. `change-intake` SHALL be contributed by
`@dsh-studio/plugin-openspec`. The review definitions are the built-in process, not product-specific
content: a new product-specific definition MUST NOT be added without its own delta, and a
contributed definition MUST run from the generic schema and MUST NOT require a new id-specific
engine behavior.

#### Scenario: Engine-shipped exceptions

- **WHEN** a fresh installation loads the engine definitions
- **THEN** `task-review`, `spec-review`, `integration-review`, `retro`, and `verify` load with their `own` ownership and the setup's legacy switches stay off

#### Scenario: Contributed intake loads

- **WHEN** the OpenSpec plugin registers `change-intake` while the engine is available
- **THEN** it loads with the requirements, architecture, interface, create-change, spec, spec-review, and approval steps, and the spec-review step is owned by the review executor

#### Scenario: No new engine content

- **WHEN** a plugin contributes a definition
- **THEN** the engine lists and runs it without an engine release that names or hard-codes that definition id
