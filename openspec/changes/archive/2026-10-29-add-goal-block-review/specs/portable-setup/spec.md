# Spec Delta

## MODIFIED Requirements

### Requirement: Dependency-contained plugins

The setup bundle MUST declare as package dependencies every repository plugin package whose rows its patch mounts, so that one installation provides all plugin code. A configuration-only adapter row MAY mount a package that the Harness installation provides; that package MUST NOT be duplicated as a setup dependency. A read-only reviewer preset declaration row MAY mount the Harness-provided `@deepseek-ai/dsh-agent-preset` package and Harness-provided read-only tool plugins; those packages MUST NOT be duplicated as setup dependencies.

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

#### Scenario: Harness-provided preset declaration

- **WHEN** the setup patch contains a `preset-goal-reviewer` declaration that names `@deepseek-ai/dsh-agent-preset` and Harness-provided read-only tool plugins
- **THEN** the setup manifest does not declare those Harness packages as dependencies, the declaration mounts, and the goal-continuity gate applies the reviewer allowlist

## ADDED Requirements

### Requirement: Read-only reviewer preset

The setup patch SHALL include a `preset-goal-reviewer` declaration from the goal-continuity fragment. The declaration SHALL expose only read-only tools and no write-capable tool. The goal-continuity gate SHALL apply the reviewer-scoped allowlist through the reviewer child's own scope; inherited global mutation tools MUST be filtered. The preset SHALL NOT rely on the session sandbox. A profile MAY override it; the gate treats a missing or non-read-only preset as unavailable.

#### Scenario: Fresh installation

- **WHEN** the setup is installed into a profile with no preset override
- **THEN** the composed profile contains `preset-goal-reviewer`, the preset exposes only read-only tools, and the gate applies the reviewer allowlist to the child

#### Scenario: Inherited global tools

- **WHEN** `mcp_call`, `delegate`, `edit`, `write`, and `pwsh` are mounted globally in the profile
- **THEN** the gate's child-scope allowlist exposes none of them

#### Scenario: Mutation attempt is denied

- **WHEN** the reviewer running under the preset attempts a mutation route
- **THEN** the tool is unknown or denied

#### Scenario: Sandbox independence

- **WHEN** the parent session has an explicit `danger-full-access` override
- **THEN** the reviewer's effective tool surface is still the read-only allowlist, because the allowlist and not the sandbox is the enforcement

#### Scenario: Profile override

- **WHEN** the profile patch overrides or disables `preset-goal-reviewer`
- **THEN** the profile declaration wins and the gate uses it only while its effective tool surface is read-only, otherwise treats the review as unavailable

#### Scenario: Single setup bundle

- **WHEN** the setup bundle is installed without a separate preset bundle
- **THEN** the preset declaration is present and the composed profile selects it through the goal-continuity gate
