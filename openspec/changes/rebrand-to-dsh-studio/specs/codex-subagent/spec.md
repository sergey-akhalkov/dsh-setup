# Spec Delta

## MODIFIED Requirements

### Requirement: Setup, removal, and documentation

The setup SHALL deliver the fork and install its `@openai/codex` dependency closure. Disable/removal
SHALL unregister the providers and status tool without deleting records or worktrees. The
documentation and market card MUST name the bundled version and `codexPath`/PATH overrides, the
login step, the cost, the provider names, and the MIT attribution.

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the fork, mounts `dsh-studio-codex-subagent` once, and installs the Codex dependency

#### Scenario: Removal

- **WHEN** the row is disabled or uninstalled
- **THEN** the providers and status tool disappear and Codex-targeted rules report the target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the documentation or market card
- **THEN** it names the bundled version, overrides, login, cost, provider names, and MIT notice, and
  states that user-configured `~/.codex` MCP servers run with their own approvals outside the Codex
  sandbox and outside the worktree-confinement guarantee
