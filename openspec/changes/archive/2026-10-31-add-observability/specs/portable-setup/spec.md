# Spec Delta

## MODIFIED Requirements

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI preferences, agent preset selection, the observability signal map that attributes the shipped plugins' tools and injected message source kinds to their owning plugin, and the shipped lazy MCP configuration (the `dsh-setup-mcp-lazy` row configured with `nuphus-mcp` and `serena`; no static `@deepseek-ai/dsh-mcp-client` row for either server). It MUST NOT modify the profile's own patch file, and the profile patch MUST continue to take precedence over the setup layer.

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
