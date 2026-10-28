# Spec Delta

## MODIFIED Requirements

### Requirement: Scoped patch entries

The setup patch SHALL insert only rows contributed by the setup and SHALL override shipped rows
only for explicit defaults. An explicit default MAY target a row the setup itself inserts, including
setting `disabled: true`; a configuration override MUST restate the complete configuration the target
row requires, while a disable override carries no configuration. The setup MUST NOT re-implement a
shipped bundle's rows or alter the profile's bundle selection list, and the profile's own patch MUST
remain the final authority over every setup override.

#### Scenario: Shipped bundle change

- **WHEN** the setup patch does not mention a shipped row
- **THEN** that row remains governed by the shipped bundle layer and its configuration is unchanged

#### Scenario: Setup row default

- **WHEN** an explicit default targets a row the setup inserts and sets its configuration or disables it
- **THEN** the generated setup patch applies the override to the row (a setup-row disable is part of its insert entry), and the composed profile shows it

#### Scenario: Profile override of a setup default

- **WHEN** the profile patch restates or re-enables a row the setup also configures
- **THEN** the profile value is effective and the setup default does not override it

#### Scenario: Bundle selection preserved

- **WHEN** the setup bundle is installed
- **THEN** the profile's `dsh.profile.bundles` list is unchanged except for the appended setup bundle

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI
preferences, agent preset selection, and the shipped Nuphus migration (the lazy row configured with
Nuphus and the static Nuphus adapter row disabled). It MUST NOT modify the profile's own patch file,
and the profile patch MUST continue to take precedence over the setup layer.

#### Scenario: Fresh profile defaults

- **WHEN** the setup is installed into a profile whose own patch is empty
- **THEN** the setup's model, theme, UI, and preset defaults are effective without further configuration

#### Scenario: Nuphus lazy default

- **WHEN** the setup is installed with no Nuphus override in the profile patch
- **THEN** the composed profile lists `nuphus-mcp` in the lazy row and the static Nuphus adapter row is inactive

#### Scenario: Local override

- **WHEN** the profile patch already sets a value that the setup also sets
- **THEN** the profile value is effective and the profile patch file is not modified by installation

#### Scenario: Restore the static Nuphus adapter

- **WHEN** the profile patch enables `dsh-setup-nuphus-mcp` and removes the lazy Nuphus entry
- **THEN** the static adapter is effective and no second Nuphus process is started by the lazy row

## ADDED Requirements

### Requirement: Nuphus migration reconciliation

The setup MUST NOT read or rewrite the profile patch. The migration documentation SHALL state the
required reconciliation for a profile that already selects either Nuphus access path. A lazy call
while the static adapter is active MUST fail with the lazy-mcp one-home error and start no process.

#### Scenario: Explicit static enable on upgrade

- **WHEN** an existing profile patch sets `disabled: false` on `dsh-setup-nuphus-mcp` and the setup default configures `nuphus-mcp` in the lazy row
- **THEN** the composed profile keeps both paths (the profile patch outranks the setup), the documentation names the required reconciliation, and a lazy call fails with the one-home error instead of starting a second process

#### Scenario: Prior opt-out on upgrade

- **WHEN** an existing profile patch disables `dsh-setup-nuphus-mcp` and the setup default configures `nuphus-mcp` in the lazy row
- **THEN** the composed profile still carries the lazy entry, and the documentation states that emptying the lazy `servers` list is required to keep Nuphus off

#### Scenario: Default profile has one path

- **WHEN** the profile patch carries no Nuphus override
- **THEN** only the lazy path is configured: the static row is disabled and the lazy row lists `nuphus-mcp`
