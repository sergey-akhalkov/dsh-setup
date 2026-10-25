# Spec Delta

## ADDED Requirements

### Requirement: Strict confirmation for machine-controlling adapters

An adapter whose server can mutate the host machine SHALL enable that server's strict
write-confirmation mode in the shipped configuration. The repository MUST document the mode, the
result of a rejected call, and the profile-level override that changes it. A later change MUST NOT
relax the shipped default without amending this requirement.

#### Scenario: Shipped default

- **WHEN** the bundle is installed and the adapter's server is available
- **THEN** the composed row enables the server's strict write-confirmation mode, so a machine-mutating tool call needs an explicit confirmation argument.

#### Scenario: Rejected write

- **WHEN** the model calls a machine-mutating tool without the confirmation argument
- **THEN** the server rejects the call, the model sees a failed tool result, and no input or window action reaches the machine.

#### Scenario: Profile-level override

- **WHEN** a user changes the confirmation mode from the profile's own patch
- **THEN** the documented override restates the complete row configuration, and the bundle's shipped configuration is unchanged.
