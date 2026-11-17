# Spec Delta

## MODIFIED Requirements

### Requirement: Removal and opt-out

Disabling or uninstalling the `dsh-studio-delegation-rules` row MUST remove its tools, gate, and skill and stop enforcement; records, progress notes, and change artifacts MUST remain, and no in-session phrase may bypass an active gate.

#### Scenario: Row removed

- **WHEN** the row is disabled or uninstalled
- **THEN** the tools, gate, and skill are absent, no gate blocks a turn, and existing records and progress notes remain

#### Scenario: No in-session bypass

- **WHEN** a session claims a delegation is unnecessary or asks to skip the gate
- **THEN** the active gate still requires the configured record or progress note

### Requirement: Setup delivery and standalone use

The generic bundle SHALL be installable on its own with any registered DSH subagent provider and SHALL be delivered by the setup bundle. It MUST NOT require the Codex fork or another `@dsh-studio` bundle to compose; the setup's defaults are the only Codex-specific configuration.

#### Scenario: Standalone generic install

- **WHEN** only the rules bundle and a non-Codex provider are installed
- **THEN** its rules, tools, and gate compose and work

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the rules bundle and mounts `dsh-studio-delegation-rules` exactly once

#### Scenario: Absent Codex

- **WHEN** the Codex fork is not installed
- **THEN** the generic engine composes and reports Codex-targeted rules as unavailable
