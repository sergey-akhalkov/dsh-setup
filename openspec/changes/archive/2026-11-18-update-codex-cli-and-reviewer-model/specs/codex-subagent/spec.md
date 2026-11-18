# Spec Delta

## MODIFIED Requirements

### Requirement: App-server execution

The provider SHALL start the bundled (or selected) Codex with the official `app-server --stdio`
protocol adapter retained from upstream and MUST surface protocol startup failures, non-completed
runs, cancellation, and timeouts as explicit errors. The bundled `0.170.0` handshake and a completed
authenticated turn are required acceptance checks.

#### Scenario: Successful run

- **WHEN** the bundled Codex accepts the handshake and is signed in
- **THEN** the provider completes the delegation and returns the target's output

#### Scenario: Protocol mismatch

- **WHEN** the selected Codex rejects the handshake or a request
- **THEN** the provider reports the protocol failure with the version

#### Scenario: Cancellation

- **WHEN** the turn is cancelled or the provider times out
- **THEN** the app-server process is stopped and the run is reported as aborted

#### Scenario: Coexistence

- **WHEN** the official `codex` provider is also registered
- **THEN** the fork's provider names remain distinct and both providers can compose

### Requirement: Bundled Codex binary

The fork SHALL declare the current latest stable `@openai/codex` npm release (`0.170.0`) as a
runtime dependency, so a profile install fetches the platform binary. It MUST NOT commit a Codex
binary or a platform-specific executable to the repository, and the status MUST report the bundled
path and version.

#### Scenario: Dependency install

- **WHEN** the fork is installed with its dependencies in a profile
- **THEN** the platform `@openai/codex` binary is present in the profile's dependency tree

#### Scenario: No committed binary

- **WHEN** the repository is inspected
- **THEN** no Codex `.exe` or other platform binary is tracked

#### Scenario: Version update

- **WHEN** the pinned `@openai/codex` version changes
- **THEN** the lockfile and the status-reported version change together
