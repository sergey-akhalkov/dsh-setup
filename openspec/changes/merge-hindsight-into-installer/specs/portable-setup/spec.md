# Spec Delta

## ADDED Requirements

### Requirement: Installer Hindsight phase

The one-command installer SHALL run the local Hindsight provisioning phase after the profile installation and verification, using the documented Hindsight options. It MUST NOT ask for the DeepSeek key or the export location before the profile phase has been installed and verified. The run summary SHALL report the phase as installed, skipped, or failed.

#### Scenario: Fresh machine with prerequisites

- **WHEN** a user runs the documented one-liner on a machine with `uv` and an available DeepSeek key
- **THEN** the profile phase installs and verifies first, the Hindsight phase then provisions the pinned runtime at `http://127.0.0.1:8888`, and the summary reports both phases

#### Scenario: Prompt order

- **WHEN** the Hindsight phase needs the DeepSeek key or the export directory and remote
- **THEN** the installer asks only after the profile installation and verification have reported success

#### Scenario: Dry run

- **WHEN** the installer runs with its dry-run option
- **THEN** it reports the planned Hindsight action and changes no Hindsight file, daemon, logon task, or export configuration

#### Scenario: Explicit opt-out

- **WHEN** the installer runs with `-NoHindsight`
- **THEN** it installs and verifies the profile and reports the Hindsight phase as intentionally skipped

### Requirement: Hindsight readiness skip

The installer SHALL skip the Hindsight phase only when the runtime matches the pinned configuration and answers healthy: the default profile and API version are current, a key resolves without prompting, the pinned tool and the coding-agent and TLS files exist, and `/health` reports a healthy connected database. A skipped phase MUST NOT write Hindsight state, prompt, verify the key, or run a retain/recall round-trip.

#### Scenario: Already configured

- **WHEN** a user reruns the documented one-liner on a machine whose Hindsight runtime is configured, pinned, and healthy
- **THEN** the installer updates the profile as usual, reports Hindsight as already configured, asks no Hindsight question, and makes no Hindsight change

#### Scenario: Optional components absent

- **WHEN** the logon task or the export configuration file is absent but every readiness fact matches
- **THEN** the phase is still skipped because those are user choices or optional components

#### Scenario: Stale or unhealthy runtime

- **WHEN** the profile records another pinned version, the installed tool version differs, or the daemon is not healthy with a connected database
- **THEN** the phase runs and updates or repairs the runtime

#### Scenario: Forced repair

- **WHEN** the installer runs with `-RepairHindsight`
- **THEN** the phase runs even when every readiness fact matches

### Requirement: Hindsight phase failure isolation

The profile installation SHALL remain the run's contract. When `uv`, an available key, or an interactive prompt is missing, the installer SHALL warn, skip the Hindsight phase, leave the profile installed, exit successfully, and name the next action. A failure after the Hindsight phase starts attempting SHALL exit non-zero, state that the profile phase succeeded, and MUST NOT roll back or re-verify the profile.

#### Scenario: Missing uv

- **WHEN** the Hindsight phase needs `uv` and the command is not available
- **THEN** the installer warns, skips the phase, exits successfully with the profile installed, and prints the documented `uv` install command

#### Scenario: Missing key without an interactive prompt

- **WHEN** no key source is available and the session is not interactive
- **THEN** the installer warns, skips the phase, exits successfully, and never writes a placeholder secret

#### Scenario: Provisioning failure after starting

- **WHEN** the phase fails after it starts attempting, for example on a rejected key, an invalid export location, or a foreign listener
- **THEN** the run exits non-zero, reports that the profile phase succeeded, restarts DeepSeek Harness, and leaves the profile in its installed state

### Requirement: Hindsight-only mode and entry point

The installer SHALL provide a Hindsight-only mode that runs the Hindsight phase without reading, writing, or restarting a DSH profile and without requiring the DSH CLI. The root `setup-hindsight.ps1` SHALL be a thin entry point that runs the installer's Hindsight-only mode, using a local sibling installer when present and the published installer otherwise, and MUST NOT duplicate provisioning logic.

#### Scenario: Restore path

- **WHEN** `restore-hindsight.ps1` invokes its sibling `setup-hindsight.ps1` with `-SkipVerify`
- **THEN** the installer's Hindsight-only mode runs, starts the daemon, and touches no DSH profile

#### Scenario: Documented legacy URL

- **WHEN** a user runs `irm .../setup-hindsight.ps1 | iex`
- **THEN** the entry point downloads the published installer and runs its Hindsight-only mode without duplicating the provisioning code

#### Scenario: Machine without a DSH profile

- **WHEN** the Hindsight-only mode runs on a machine with no DSH profile or CLI
- **THEN** it provisions the runtime and reports success without asking for a profile

#### Scenario: Option forwarding

- **WHEN** the entry point receives the documented Hindsight options
- **THEN** it forwards them unchanged to the Hindsight-only mode
