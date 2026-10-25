# Spec Delta

## ADDED Requirements

### Requirement: Guidance module beside an adapter row

A bundle that configures an external MCP server MAY additionally ship a Host module that registers
guidance for that server's contract. Such a module SHALL NOT be required for the adapter row to
mount: if it fails or the row is disabled, the server's tools MUST remain available exactly as for a
bundle without a Host module, and the module MUST NOT change the server's configuration.

#### Scenario: Skill registered beside the adapter

- **WHEN** a bundle ships a Host module that registers a guidance skill and keeps its adapter row
- **THEN** the catalog lists that skill and the adapter row still mounts the MCP client

#### Scenario: Adapter row alone

- **WHEN** the same bundle's Host module is removed or disabled
- **THEN** the server's tools remain available as `mcp__<serverName>__<tool>` and its configuration is unchanged

## MODIFIED Requirements

### Requirement: Approved adapter targets

A fragment row SHALL name either its owning package or an adapter package from the repository's
approved set, which currently contains only `@deepseek-ai/dsh-mcp-client`. Generation MUST reject any
other row name, whether or not the owning package also declares a Host or Client entry.

#### Scenario: Unapproved package

- **WHEN** a fragment row names a package outside the approved set
- **THEN** generation fails with a message naming the offending row.

#### Scenario: Code-bearing package

- **WHEN** a package with a Host or Client entry declares a foreign adapter row from the approved set
- **THEN** generation succeeds instead of rejecting the combination.
