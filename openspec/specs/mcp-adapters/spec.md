# mcp-adapters Specification

## Purpose

Lets one installable bundle expose an external MCP server's tools to the Harness through the
Harness-provided MCP client, without hard-coding machine-local configuration. A bundle stays
configuration-only or ships a Host module that also contributes guidance for that server; the adapter
row mounts either way.

## Requirements

### Requirement: Configuration-only adapter bundles

A plugin bundle MAY expose an external MCP server without adding a Host or Client module. Its
composition fragment SHALL name the Harness-provided adapter package, and generation SHALL produce
the bundle patch from that fragment exactly as for a code-bearing plugin.

#### Scenario: Standalone install

- **WHEN** a user installs the configuration-only bundle into a profile
- **THEN** the bundle patch mounts the Harness-provided MCP client row and the server's tools become available as `mcp__<serverName>__<tool>`.

#### Scenario: Setup install

- **WHEN** the bundle is part of the setup bundle
- **THEN** the setup patch inserts its adapter row and the setup manifest declares the bundle as a dependency like every other plugin.

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

### Requirement: External runtime prerequisites

An adapter bundle MAY require an external runtime that it does not ship. The bundle MUST NOT vendor
that runtime and MUST NOT use an install-time script to obtain it. The shipped configuration SHALL
NOT abort Harness startup when the runtime is unavailable, and the repository MUST document the
prerequisite.

#### Scenario: Missing prerequisite

- **WHEN** the adapter's external runtime is not installed
- **THEN** the Harness starts normally without the adapter's tools and reports the failed connection in the logs.

#### Scenario: Documented prerequisite

- **WHEN** a user installs the adapter bundle
- **THEN** the repository documentation states the runtime prerequisite and the first-run behavior before the tools are available.

### Requirement: Workspace activation without machine paths

An adapter that operates on a workspace MUST NOT contain a machine-local project path. It SHALL
guide the agent to activate the current workspace at runtime, and one profile-wide adapter instance
MAY serve several sessions, with project switching shared across them.

#### Scenario: No hard-coded path

- **WHEN** repository validation inspects the adapter bundle
- **THEN** it finds no absolute project path, credential, or session data in the patch or its configuration.

#### Scenario: First use

- **WHEN** an agent first uses a workspace-scoped adapter in a session
- **THEN** the adapter's instructions lead the agent to activate the session's workspace before using its tools.

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
