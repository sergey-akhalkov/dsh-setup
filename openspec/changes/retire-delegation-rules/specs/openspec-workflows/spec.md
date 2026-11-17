# Spec Delta

## MODIFIED Requirements

### Requirement: Change-intake contribution

When the workflows registry service is available, the OpenSpec plugin SHALL register the `change-intake` definition from its own read-only asset. The definition SHALL keep the requirements, architecture, interface, create-change, spec, spec-review, and approval steps; the `spec-review` step SHALL be owned by the review executor and carry no legacy source. The plugin MUST NOT register it when the service is absent.

#### Scenario: Engine present

- **WHEN** the workflows registry service is available
- **THEN** the definition is listed with the OpenSpec plugin as its source, with the seven steps and the owned spec-review step

#### Scenario: Engine absent

- **WHEN** the workflows engine or its registry service is not installed
- **THEN** the plugin registers nothing and its panel and skill surfaces keep working

#### Scenario: Engine refuses the definition

- **WHEN** the engine refuses a contributed definition
- **THEN** the engine reports its existing remedy and the OpenSpec plugin still loads
