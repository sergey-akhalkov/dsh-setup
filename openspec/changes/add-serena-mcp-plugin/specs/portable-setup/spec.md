# Spec Delta

## MODIFIED Requirements

### Requirement: Dependency-contained plugins

The setup bundle MUST declare as package dependencies every repository plugin package whose rows its patch mounts, so that one installation provides all plugin code. A configuration-only adapter row MAY mount a package that the Harness installation provides; that package MUST NOT be duplicated as a setup dependency.

#### Scenario: Fresh profile

- **WHEN** the setup bundle is installed into a profile that declares none of the plugin packages
- **THEN** every plugin module referenced by the setup patch resolves and mounts.

#### Scenario: Missing dependency detection

- **WHEN** a plugin row is present in the setup patch but its repository package is absent from the setup bundle's dependencies
- **THEN** release validation fails before publication.

#### Scenario: Self-contained git installation

- **WHEN** the setup bundle is installed from its commit-pinned git spec
- **THEN** every declared plugin package's code arrives with that single installation, without a registry lookup or an additional install step.

#### Scenario: Harness-provided adapter target

- **WHEN** the setup patch contains a configuration-only adapter row that names a package shipped with the Harness
- **THEN** the setup manifest does not declare that package as a dependency, and the row resolves from the Harness installation without a second copy.
