# Spec Delta

## MODIFIED Requirements

### Requirement: Opt-out and rollback

Disabling the `dsh-studio-hindsight` row SHALL remove the Hindsight tools, injection, and retention while leaving every other setup row effective. The companion skill file under `~/.agents/skills/hindsight-coding-agent` is owned by the upstream plugin and MAY remain on disk; the documentation SHALL name that persistence, the manual deletion, and the upstream `disabled` switch. Re-enabling SHALL require a full Harness restart.

#### Scenario: Row disabled

- **WHEN** the profile disables the `dsh-studio-hindsight` row
- **THEN** the agent has no `hindsight_*` tools, no memory injection, and no retention, and other setup rows still compose

#### Scenario: Companion skill persistence

- **WHEN** the row is disabled after the plugin installed its companion skill
- **THEN** the skill file may still exist under the shared agents skills root, and the documentation states that deleting it is a manual cleanup step

#### Scenario: Config disabled

- **WHEN** the machine-local config sets `disabled: true` while the row remains mounted
- **THEN** the plugin is inert and makes no memory requests

#### Scenario: Re-enabled after restart

- **WHEN** the row is re-enabled or the config switch is removed and the Harness is fully restarted
- **THEN** the tools, injection, and retention return, and the companion skill is present or re-installed

### Requirement: Default-on durable export

The `dsh-studio-hindsight` row SHALL default `export.enabled` to true and expose the target directory, interval, auto-commit, auto-push, history, and attachment settings. Disabling export MUST stop all Git activity without affecting memory. The target directory MUST default outside the DSH home.

#### Scenario: Default configuration

- **WHEN** the setup is installed and no export configuration overrides the row
- **THEN** export is enabled and writes to a directory outside the DSH home

#### Scenario: Export disabled

- **WHEN** the row or machine-local configuration sets `export.enabled` to false
- **THEN** the plugin writes no export files and runs no Git command

#### Scenario: Target outside the DSH home

- **WHEN** the default target directory is resolved
- **THEN** it is not under the DSH home or the Hindsight `pg0` instance path
