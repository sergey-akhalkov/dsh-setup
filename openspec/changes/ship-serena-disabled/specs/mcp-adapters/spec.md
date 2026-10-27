# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration-only adapter bundles

A plugin bundle MAY expose an external MCP server without adding a Host or Client module. Its composition fragment SHALL name the Harness-provided adapter package, and generation SHALL produce the bundle patch from that fragment exactly as for a code-bearing plugin. A bundle MAY ship its rows disabled by default; the patch MUST still mount them, and the documentation and market card MUST state the one-line profile override that enables them.

#### Scenario: Standalone install

- **WHEN** a user installs the configuration-only bundle into a profile
- **THEN** the bundle patch mounts the Harness-provided MCP client row, and once that row is enabled the server's tools become available as `mcp__<serverName>__<tool>`

#### Scenario: Setup install

- **WHEN** the bundle is part of the setup bundle
- **THEN** the setup patch inserts its adapter row and the setup manifest declares the bundle as a dependency like every other plugin

#### Scenario: Shipped disabled

- **WHEN** a bundle ships its rows disabled by default and no profile patch overrides them
- **THEN** the profile composes normally with the rows mounted and inactive, no tools from that server appear, and enabling requires only setting `disabled: false` on the row in the profile patch
