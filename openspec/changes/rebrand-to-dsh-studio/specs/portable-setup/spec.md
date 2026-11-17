# Spec Delta

## ADDED Requirements

### Requirement: Project identity and row namespace

The repository SHALL carry the `dsh-studio` identity in every current, user-visible namespace: the
repository and Pages URL, the `@dsh-studio/` package scope with `@dsh-studio/setup`, the
`dsh-studio-` row prefix, and the `dsh-studio:` prompt-section prefix. The installer defaults SHALL
name the same repository. A release under this identity MUST be `1.0.0`, tagged `v1.0.0`.

#### Scenario: Current packages

- **WHEN** the repository package manifests are inspected
- **THEN** every package declares a name under `@dsh-studio/`, and the setup bundle is `@dsh-studio/setup`

#### Scenario: Current rows and sections

- **WHEN** the composition fragments, the generated patches, and the guidance plugins are inspected
- **THEN** every current row id starts with `dsh-studio-` and the four guidance prompt sections start with `dsh-studio:`

#### Scenario: Installer defaults

- **WHEN** the installer's index and repository defaults are inspected
- **THEN** both name the new repository

#### Scenario: No mixed identity

- **WHEN** a current package name, row id, or prompt section is inspected
- **THEN** it does not keep the old `dsh-setup` spelling

#### Scenario: Published identity

- **WHEN** version `1.0.0` is tagged and published
- **THEN** the index at the documented Pages URL lists `@dsh-studio/setup` `1.0.0` with its commit pin

#### Scenario: Historical artifacts keep the old spelling

- **WHEN** archived changes, historical status notes, review records, and the retired adapter row allowance are inspected
- **THEN** they still use the `dsh-setup` spelling

### Requirement: Legacy setup migration

The installer SHALL detect a target profile that depends on or selects `@dsh-setup/setup` before
writing anything, refuse the run, and name the legacy bundle, the removal action, and the rerun
command. It MUST NOT install the new setup beside it, remove its dependency, or rewrite the profile
patch. The documentation SHALL name the pre-migration snapshot, the manual removal step, and the stale
row-id overrides.

#### Scenario: Legacy profile refused

- **WHEN** the target profile still depends on or selects `@dsh-setup/setup`
- **THEN** the installer stops before changing any file and names the legacy bundle and the removal-and-rerun action

#### Scenario: Both setups never compose

- **WHEN** the installer refuses a legacy profile
- **THEN** the profile's bundle selection and patch are unchanged and `@dsh-studio/setup` is not installed

#### Scenario: Fresh profile unaffected

- **WHEN** the target profile has no legacy setup
- **THEN** the installer proceeds with its normal install and verification

#### Scenario: Stale row overrides documented

- **WHEN** the installation documentation is read
- **THEN** it names the `dsh-setup-…` profile-patch row ids that stop applying and their `dsh-studio-…` spelling

## MODIFIED Requirements

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI preferences, agent preset selection, the observability signal map that attributes the shipped plugins' tools and injected message source kinds to their owning plugin, and the shipped lazy MCP configuration (the `dsh-studio-mcp-lazy` row configured with `nuphus-mcp` and `serena`; no static `@deepseek-ai/dsh-mcp-client` row for either server). It MUST NOT modify the profile's own patch file, and the profile patch MUST continue to take precedence over the setup layer.

#### Scenario: Fresh profile defaults

- **WHEN** the setup is installed into a profile whose own patch is empty
- **THEN** the setup's model, theme, UI, and preset defaults are effective without further configuration

#### Scenario: Nuphus lazy default

- **WHEN** the setup is installed with no MCP override in the profile patch
- **THEN** the composed profile lists `nuphus-mcp` and `serena` in the lazy row and mounts no static adapter row for either server

#### Scenario: Local override

- **WHEN** the profile patch already sets a value that the setup also sets
- **THEN** the profile value is effective and the profile patch file is not modified by installation

#### Scenario: Restore the static Nuphus adapter

- **WHEN** the profile patch adds a static `@deepseek-ai/dsh-mcp-client` row for `nuphus-mcp` and removes the lazy Nuphus entry
- **THEN** the static adapter is effective and the lazy row starts no process; the setup does not ship that static row

#### Scenario: Observability attribution default

- **WHEN** the setup is installed with no observability override in the profile patch
- **THEN** the composed observability row carries the shipped signal map, and the Observability view attributes a mapped tool to its plugin row
