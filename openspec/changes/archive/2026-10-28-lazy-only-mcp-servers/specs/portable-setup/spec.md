# Spec Delta

## MODIFIED Requirements

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI preferences, agent preset selection, and the shipped lazy MCP configuration (the `dsh-setup-mcp-lazy` row configured with `nuphus-mcp` and `serena`; no static `@deepseek-ai/dsh-mcp-client` row for either server). It MUST NOT modify the profile's own patch file, and the profile patch MUST continue to take precedence over the setup layer.

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

### Requirement: Nuphus migration reconciliation

The setup MUST NOT read or rewrite the profile patch. The migration documentation SHALL state the required reconciliation for a profile that still targets the removed static Nuphus or Serena adapter row, or carries a static row of its own. A lazy call while a static adapter is active MUST fail with the lazy-mcp one-home error and start no process.

#### Scenario: Explicit static enable on upgrade

- **WHEN** an existing profile patch still sets `disabled: false` on the removed `dsh-setup-nuphus-mcp` row and the setup's lazy row configures `nuphus-mcp`
- **THEN** the composed profile carries only the lazy entry, the profile patch is not rewritten, and the documentation names the stale override to remove

#### Scenario: Prior opt-out on upgrade

- **WHEN** an existing profile patch disables the removed `dsh-setup-nuphus-mcp` row and the setup's lazy row configures `nuphus-mcp`
- **THEN** the composed profile still carries the lazy entry, and the documentation states that emptying the lazy `servers` list is required to keep Nuphus off

#### Scenario: Default profile has one path

- **WHEN** the profile patch carries no Nuphus or Serena override
- **THEN** only the lazy path is configured: the lazy row lists `nuphus-mcp` and `serena` and no static adapter row is mounted

### Requirement: Non-destructive owner-profile verification

The repository SHALL provide a dogfood command that verifies the installer against a copy of the current machine's Desktop profile. The command MUST NOT write that profile, stop or restart the running Harness, or disturb any Harness home outside the throwaway copy. The installer MUST refuse to close the Harness whose process tree hosts the calling shell. The command's owner-row preservation check SHALL treat `dsh-setup-nuphus-mcp` and `dsh-setup-serena` as explicitly retired adapter rows that may disappear from the composed copy, while every other owner-patched row MUST keep its effective config.

#### Scenario: Dogfood on the owner's machine

- **WHEN** a developer runs the documented dogfood command from a shell hosted by the running Harness
- **THEN** the installer runs against a throwaway copy of the profile, the composed copy shows the setup rows and defaults effective, every owner-patched row except the retired adapter rows keeps its effective config, the retired adapter rows may be absent, and the live profile's files are byte-identical afterwards

#### Scenario: Live install from a hosted shell

- **WHEN** the installer is asked to target the `desktop` profile from a shell hosted by the running Harness
- **THEN** it stops before changing anything and points to the external-PowerShell and dogfood alternatives

#### Scenario: Retired adapter row override

- **WHEN** the owner's profile patch still targets `dsh-setup-nuphus-mcp` or `dsh-setup-serena` and the installed composition omits that row
- **THEN** the dogfood preservation check reports the intended retirement, does not fail for the missing retired row, and still fails when any other owner-patched row disappears
