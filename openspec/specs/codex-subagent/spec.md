# codex-subagent Specification

## Purpose
Defines the forked Codex subagent provider: installed-CLI discovery through `path` or `PATH`, validation and status, read-only and workspace-write provider instances, app-server execution, and its license, security, and setup boundaries.

## Requirements

### Requirement: Forked provider base and license

The bundle SHALL vendor the MIT-licensed `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3` provider code as its base, record the upstream source and license in a NOTICE/README, and document the local patch. It MUST NOT depend on the official Codex provider package at runtime.

#### Scenario: Upstream base

- **WHEN** the fork package is inspected
- **THEN** it contains the upstream provider code, its MIT notice, and the recorded upstream version

#### Scenario: Local patch record

- **WHEN** a maintainer compares the fork with upstream
- **THEN** the README names the binary-resolution/path changes and the rebase procedure

#### Scenario: No official dependency

- **WHEN** the profile does not install the official Codex provider
- **THEN** the fork still registers its providers

### Requirement: Installed Codex discovery

The provider SHALL resolve the Codex CLI from an explicit `codexPath` when configured, otherwise from `codex` on `PATH`, and SHALL validate the result with `codex --version`. It MUST NOT fall back to the bundled `0.153.4` binary and MUST report a clear path/config error when discovery or validation fails.

#### Scenario: Explicit path

- **WHEN** `codexPath` is set to an existing executable
- **THEN** that executable is used and its version is recorded

#### Scenario: PATH discovery

- **WHEN** `codexPath` is omitted and `codex` is on PATH
- **THEN** the first resolvable Codex command is used

#### Scenario: Missing CLI

- **WHEN** no `codexPath` and no `codex` on PATH resolves
- **THEN** the run fails with the `codexPath` config key and the status-tool next action

#### Scenario: Invalid CLI

- **WHEN** the configured path does not exist or `codex --version` fails
- **THEN** the provider reports the path and command failure instead of starting an app-server

#### Scenario: No bundled fallback

- **WHEN** the installed CLI is unavailable
- **THEN** the provider never silently runs its package-local bundled binary

### Requirement: Windows command handling

On Windows the provider SHALL spawn a `.cmd`/`.bat` through `ComSpec` with fixed arguments and an `.exe` directly, and MUST pass the delegation prompt through the app-server stdin rather than a shell. The resolved path and version MUST be available from `codex_subagent_status`.

#### Scenario: CMD shim

- **WHEN** discovery returns a `codex.cmd` npm shim
- **THEN** the provider starts it through `ComSpec` and the app-server protocol still works

#### Scenario: EXE

- **WHEN** `codexPath` points at `codex.exe`
- **THEN** the provider spawns it directly with no shell wrapper

#### Scenario: Prompt transport

- **WHEN** a review or answer prompt is sent
- **THEN** it reaches the app-server through stdin and is not interpolated into a command line

### Requirement: Provider instances and status

The fork SHALL register a read-only `codex-subagent` provider and a workspace-write `codex-subagent-write` provider, and a `codex_subagent_status` tool that reports the resolved path, version, source (`config` or `PATH`), and a paste-ready `codexPath` snippet. It MUST NOT write the profile patch automatically.

#### Scenario: Read-only instance

- **WHEN** a review or answer rule targets `codex-subagent`
- **THEN** the run uses the read-only instance

#### Scenario: Write instance

- **WHEN** a patch rule targets `codex-subagent-write`
- **THEN** the run uses the workspace-write instance in the rule's isolated worktree

#### Scenario: Status

- **WHEN** `codex_subagent_status` is called
- **THEN** it reports the path, version, source, and a snippet for pinning `codexPath`

#### Scenario: No profile write

- **WHEN** the status tool reports a detected path
- **THEN** the profile's `cordis.patch.yml` is unchanged

### Requirement: App-server execution

The provider SHALL start the installed Codex with the official `app-server --stdio` protocol adapter retained from upstream, and MUST surface protocol startup failures, non-completed runs, cancellation, and timeouts as explicit errors. The installed 0.164.0 handshake is a required acceptance check.

#### Scenario: Successful run

- **WHEN** the installed Codex accepts the app-server handshake
- **THEN** the provider completes the delegation and returns the target's output

#### Scenario: Protocol mismatch

- **WHEN** the installed Codex rejects the handshake or a request
- **THEN** the provider reports the protocol failure with the Codex version

#### Scenario: Cancellation

- **WHEN** the turn is cancelled or the provider times out
- **THEN** the app-server process is stopped and the run is reported as aborted

#### Scenario: Coexistence

- **WHEN** the official `codex` provider is also registered
- **THEN** the fork's provider names remain distinct and both providers can compose

### Requirement: Security and no bundled Codex

The fork MUST NOT install, vendor, or sign in to Codex; it uses the user's installed CLI, config, and auth. It MUST spawn with fixed arguments, keep credentials out of records and logs, and document that the user's Codex sandbox/config governs the target's permissions.

#### Scenario: No install or sign-in

- **WHEN** the package is inspected or the plugin is installed
- **THEN** it contains no Codex binary, installer, or sign-in automation

#### Scenario: User config

- **WHEN** the provider runs the installed Codex
- **THEN** the user's Codex config, MCP servers, skills, and auth apply

#### Scenario: No secret leakage

- **WHEN** the provider writes a record or log
- **THEN** it contains no credentials, tokens, or machine paths beyond the resolved CLI path

#### Scenario: Fixed spawn arguments

- **WHEN** the provider starts the CLI
- **THEN** the argument list is fixed and the prompt is not passed through a shell

### Requirement: Setup, removal, and documentation

The setup SHALL deliver the fork and disable/removal SHALL unregister its providers and status tool without deleting records or worktrees. The documentation and market card MUST name the installed Codex prerequisite, the auto-detect/`codexPath` UX, the model/effort config, the cost, the provider names, and the MIT attribution.

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the fork and mounts `dsh-setup-codex-subagent` exactly once

#### Scenario: Removal

- **WHEN** the row is disabled or uninstalled
- **THEN** the providers and status tool disappear and Codex-targeted rules report the target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the documentation or market card
- **THEN** it names the installed CLI, path discovery, config, cost, provider names, and MIT notice

### Requirement: Maintenance and DSH support

The fork SHALL record its upstream version and rebase procedure, and a DSH support-version change MUST include rebasing the fork and re-running its app-server acceptance. The copied code MUST stay isolated in this package so an upstream update does not touch the generic rules engine.

#### Scenario: DSH bump

- **WHEN** the repository's supported DSH version changes
- **THEN** the fork is rebased and its acceptance re-run before release

#### Scenario: Isolation

- **WHEN** the fork is updated
- **THEN** only the fork package's vendored code changes, not the generic engine
