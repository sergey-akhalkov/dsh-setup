# Spec Delta

## REMOVED Requirements

### Requirement: Shipped Nuphus migration

**Reason**: The setup now ships Nuphus and Serena as lazy entries and mounts no static adapter row, so the static-row migration and the restore-the-static-adapter path this requirement described no longer exist.

**Migration**: Reach both servers through the `nuphus-mcp` and `serena` lazy entries with `mcp_tools`/`mcp_call`; remove any profile static adapter row for either server. The lazy entry carries the `--confirm-write` argument and the 120000 ms tool timeout.

## ADDED Requirements

### Requirement: Shipped lazy MCP servers

The setup bundle SHALL configure `nuphus-mcp` and `serena` as the `dsh-setup-mcp-lazy` servers, carrying each server's command, arguments (including `--confirm-write` for Nuphus), working directory and tool-call timeout. It MUST NOT mount a static `@deepseek-ai/dsh-mcp-client` row for either server. The Nuphus and Serena guidance bundles SHALL ship only their enabled guidance row and state that the server is reached through the lazy proxy, not static `mcp__<serverName>__*` tools.

#### Scenario: Fresh setup composition

- **WHEN** the setup is installed with no override
- **THEN** the lazy row lists `nuphus-mcp` and `serena`, no static adapter row for either server is mounted, the guidance rows are enabled, and the model-facing request contains `mcp_tools`/`mcp_call` but no `mcp__nuphus-mcp__*` or `mcp__serena__*`

#### Scenario: Nuphus confirmation

- **WHEN** a lazy Nuphus call reaches a machine-mutating tool without the confirmation argument
- **THEN** the server rejects the call, the model sees the failure, and no machine action occurs

#### Scenario: Serena on demand

- **WHEN** the model lists and calls the `serena` server through `mcp_tools`/`mcp_call`
- **THEN** the server starts on the first call, its text result reaches the model, later calls reuse the process, and the symbol tools are available after `activate_project`

#### Scenario: No static home

- **WHEN** a profile mounts a static `@deepseek-ai/dsh-mcp-client` row for `nuphus-mcp` or `serena`
- **THEN** the lazy call fails with the one-home error naming the server and the static row or tool, and no second process starts

#### Scenario: Profile override

- **WHEN** a profile patch adds, removes, or replaces a lazy server entry
- **THEN** the profile patch restates the complete `servers` list, and the setup's shipped list is unchanged
