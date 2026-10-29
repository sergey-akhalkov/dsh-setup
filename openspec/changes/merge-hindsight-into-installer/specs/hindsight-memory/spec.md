# Spec Delta

## MODIFIED Requirements

### Requirement: One-click local bootstrap

The documented one-command installer SHALL provision the local Hindsight runtime after the profile installation and verification. With a DeepSeek key available it installs the pinned `hindsight-embed`, configures the local profile and TLS trust, starts the daemon, registers the logon start, writes the machine-local coding-agent configuration, and verifies a retain/recall round-trip. The bootstrap MUST be idempotent, MUST NOT print or commit the key, and its dry run MUST change nothing.

#### Scenario: Fresh machine with a key

- **WHEN** a Windows machine with `uv` and an available DeepSeek key runs the documented one-liner
- **THEN** the profile phase completes first, the daemon is healthy at `http://127.0.0.1:8888`, the logon task exists by default, and the verification recall returns the retained marker

#### Scenario: Existing installation

- **WHEN** the installer runs again on an already provisioned and healthy machine
- **THEN** the Hindsight phase is skipped, the daemon, database, profile, and logon task are preserved, no duplicate daemon starts, and health still answers

#### Scenario: Missing key

- **WHEN** no key is available from the parameter, environment, or machine-local file and the session is interactive
- **THEN** the installer prompts securely, verifies the key, and only then changes the runtime, and it never writes a placeholder secret

#### Scenario: Missing key without an interactive prompt

- **WHEN** no key is available and the session is not interactive
- **THEN** the installer warns, skips the Hindsight phase before changing the runtime, names the missing prerequisite, and writes no placeholder secret

#### Scenario: Dry run

- **WHEN** the installer runs with its dry-run option
- **THEN** it reports the planned Hindsight actions and changes no file, daemon, or scheduled task
