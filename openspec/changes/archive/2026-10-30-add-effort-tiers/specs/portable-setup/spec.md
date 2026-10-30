# Spec Delta

## ADDED Requirements

### Requirement: Shipped reasoning effort default

The setup owner defaults SHALL set the default agent row's reasoning effort to `max`, so every
installation starts with the main session at maximum effort. The profile patch SHALL continue to take
precedence over the shipped default.

#### Scenario: Fresh profile default

- **WHEN** the setup is installed into a profile whose own patch does not set the default agent row
- **THEN** the composed profile's default agent row uses `reasoningEffort: max`

#### Scenario: Local override

- **WHEN** the profile patch sets a different reasoning effort on the default agent row
- **THEN** the profile value is effective and the setup layer is unchanged
