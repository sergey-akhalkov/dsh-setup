# hindsight-memory Specification

## Purpose
Provides local, per-repository long-term memory to DeepSeek Harness sessions through the official Hindsight native plugin, with a local-only default connection and a documented opt-out.

## Requirements

### Requirement: Native Hindsight memory is shipped

The setup bundle SHALL mount Hindsight as an active composition row by default. The row MUST load the official native DSH entry point; recall, retention, and the memory tools MUST NOT require an MCP server. A fresh profile installation SHALL compose the row without manual profile edits.

#### Scenario: Fresh installation

- **WHEN** the setup bundle is installed into a profile with no Hindsight configuration
- **THEN** the composed profile contains the active Hindsight row and no MCP adapter row for Hindsight

#### Scenario: Automatic memory lifecycle

- **WHEN** a session runs in a git repository while the local Hindsight server is available
- **THEN** the plugin seeds the repository, injects recalled context on later prompts, and retains the completed session without a manual command

#### Scenario: Native tool surface

- **WHEN** a session starts with the row active and the local server available
- **THEN** the agent can call the `hindsight_*` tools, including diagnose, sync status, page search, page read, and reflect

### Requirement: Local-only connection default

The Hindsight row SHALL default to `serverMode: self-hosted` at `http://127.0.0.1:8888`. With no machine-local Hindsight configuration, the effective endpoint MUST be that loopback server, and the shipped default MUST NOT be Hindsight Cloud.

#### Scenario: No machine-local configuration

- **WHEN** the setup is installed and `~/.hindsight/coding-agent.json` does not exist
- **THEN** the effective Hindsight endpoint is `http://127.0.0.1:8888` in self-hosted mode

#### Scenario: No Cloud fallback

- **WHEN** a session uses the shipped default connection
- **THEN** memory requests target the loopback endpoint and not the Hindsight Cloud URL

### Requirement: Local server provisioning

The documented setup procedure SHALL provision the `hindsight-embed` default-profile daemon at `http://127.0.0.1:8888`, bound to loopback, with a recorded embedded `pg0` database, explicit default-profile selection, an idempotent logon start, and the machine-local coding-agent configuration when absent. Provisioning MUST be idempotent and preserve existing daemon data and configuration.

#### Scenario: Fresh machine provisioning

- **WHEN** the provisioning procedure runs on a machine with no Hindsight daemon
- **THEN** the daemon is healthy at `http://127.0.0.1:8888` with the DeepSeek provider configured, and the machine-local coding-agent configuration names that endpoint

#### Scenario: Idempotent rerun

- **WHEN** provisioning runs again on a machine that already has a healthy daemon, its data, and a configuration file
- **THEN** the existing daemon and data are preserved, no duplicate daemon is started, and health still answers

#### Scenario: Existing database

- **WHEN** the machine already has an explicit database override, an implicit `hindsight-embed-` instance, or a data directory
- **THEN** provisioning preserves it, records the actual instance path, and does not redirect the existing daemon to a new empty database

#### Scenario: Populated implicit database

- **WHEN** a populated default-profile database exists at the implicit `hindsight-embed-` instance without an explicit override
- **THEN** provisioning preserves that database and a previously retained memory remains recallable after a daemon restart

#### Scenario: Explicit default profile

- **WHEN** another embed profile is active or selected through the environment
- **THEN** provisioning and the logon start still operate on the default profile, and the owner's active-profile selection is unchanged

#### Scenario: Loopback only

- **WHEN** the daemon is provisioned
- **THEN** the API port is bound to `127.0.0.1` and is not reachable from another host

#### Scenario: Logon start

- **WHEN** the host reboots and the owner logs in
- **THEN** the registered logon start brings the daemon back to a healthy state without a manual command

#### Scenario: Data survives a daemon restart

- **WHEN** the daemon restarts
- **THEN** the server returns healthy and a previously retained, uniquely identifiable memory is still recalled from the recorded `pg0` instance (the shipped configuration uses `~/.pg0/instances/hindsight-embed-default`)

### Requirement: Provisioning trust and credential boundary

Provisioning SHALL verify that a listener on the API port is the intended Hindsight daemon before reusing it, and MUST refuse an unrelated listener without terminating it. The extraction credential MUST come from an untracked machine-local source; a missing credential MUST stop provisioning without storing a placeholder.

#### Scenario: Foreign listener

- **WHEN** a non-Hindsight process on port 8888 answers HTTP 200 for `/health`
- **THEN** provisioning refuses to reuse it, does not terminate it, and reports that the listener is not the intended daemon

#### Scenario: Missing credential

- **WHEN** the DeepSeek extraction credential is not available from the machine-local source
- **THEN** provisioning stops before reporting success, names the missing prerequisite, and stores no placeholder secret

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

### Requirement: Local daemon autostart

The Hindsight row SHALL default `autostart` to true. When the effective connection is self-hosted at the managed loopback endpoint `http://127.0.0.1:8888`, the wrapper SHALL probe `/health` and start the installed local daemon detached if it is unhealthy. It MUST NOT block or fail Harness startup, MUST NOT install the tool, and MUST be disableable with `autostart: false`.

#### Scenario: Default local start

- **WHEN** the row defaults to self-hosted at `127.0.0.1:8888` and the local daemon is stopped
- **THEN** the wrapper attempts a detached local start, the Harness session continues, and memory becomes available once the daemon is healthy

#### Scenario: Healthy daemon

- **WHEN** the local daemon already answers `/health`
- **THEN** the wrapper starts no second daemon

#### Scenario: Autostart disabled

- **WHEN** the row or machine-local config sets `autostart: false`
- **THEN** the wrapper does not attempt a local start

#### Scenario: Tool not installed

- **WHEN** the local `hindsight-embed` tool is unavailable
- **THEN** the wrapper makes no successful start, the Harness still boots, and the one-click bootstrap remains the documented install path

### Requirement: Autostart scope

Autostart MUST use the effective upstream connection: machine-local `harnesses.dsh` overrides apply, and the attempt SHALL be skipped for Cloud, a remote URL, a different loopback port, daemon mode, a disabled config, or unresolved `paths`/`banks` connection overrides. It MUST NOT start a local daemon for an endpoint it cannot manage.

#### Scenario: Harness-scoped override

- **WHEN** `harnesses.dsh` selects Cloud, a remote URL, or `disabled: true` while the top level is local
- **THEN** the wrapper does not attempt a local start

#### Scenario: Path or bank override

- **WHEN** a `paths.<prefix>` or `banks.<bankId>` entry carries a connection or disabled override
- **THEN** the wrapper skips autostart because the Host-wide effective connection cannot be determined safely

#### Scenario: Different loopback port

- **WHEN** the effective `apiUrl` is a loopback address other than the managed `127.0.0.1:8888`
- **THEN** the wrapper does not start the default-profile daemon

#### Scenario: Cloud or remote connection

- **WHEN** the effective connection is Cloud, a remote self-hosted URL, or daemon mode
- **THEN** the wrapper does not attempt a local start

### Requirement: Machine-local configuration precedence

A machine-local `~/.hindsight/coding-agent.json` and explicitly set Hindsight environment variables SHALL take precedence over the shipped row defaults. A profile patch MAY override the row configuration, but such an override MUST restate the complete connection configuration. The repository MUST NOT contain an API token or an LLM key.

#### Scenario: Config-file override

- **WHEN** `~/.hindsight/coding-agent.json` sets a server mode or endpoint
- **THEN** the file value is effective and the shipped row default does not replace it

#### Scenario: Environment override

- **WHEN** the config file omits a field and an explicit Hindsight environment variable sets it
- **THEN** the environment value is effective

#### Scenario: Profile row override

- **WHEN** the profile patch restates the Hindsight row configuration
- **THEN** the restated configuration is effective, and a value in the config file still wins over it

#### Scenario: No secrets in the repository

- **WHEN** repository validation inspects the setup and plugin files
- **THEN** it finds no Hindsight or LLM credential and documentation uses placeholders only

### Requirement: Server unavailability does not break the Harness

When the local Hindsight server is unavailable, Harness startup and conversation SHALL continue. Memory operations fail open, the failure is observable in plugin diagnostics, and the diagnose tool reports the resolved endpoint.

#### Scenario: Server down at startup

- **WHEN** the Harness starts while the local Hindsight server is not running
- **THEN** the Harness starts normally, the session remains usable, and memory operations report a failure without aborting the turn

#### Scenario: Server returns later

- **WHEN** the local server becomes reachable after a failed memory operation
- **THEN** a later memory operation succeeds without reinstalling the setup or restarting the Harness

### Requirement: Upstream-owned lifecycle and guidance

The integration SHALL reuse the official plugin's lifecycle, native tools, and companion skill. The setup MUST NOT ship a parallel memory implementation, an MCP memory adapter, or an additional always-on prompt rule for Hindsight. On the first session, the companion skill SHALL be available to the skill catalog.

#### Scenario: Companion skill

- **WHEN** the first session starts with the row active
- **THEN** the companion skill is installed in the agent skills root and listed in the catalog on demand

#### Scenario: No duplicate guidance

- **WHEN** the generated setup patch and prompt contributions are inspected
- **THEN** they contain no Hindsight MCP adapter row and no setup-owned always-on Hindsight section

### Requirement: Opt-out and rollback

Disabling the `dsh-setup-hindsight` row SHALL remove the Hindsight tools, injection, and retention while leaving every other setup row effective. The companion skill file under `~/.agents/skills/hindsight-coding-agent` is owned by the upstream plugin and MAY remain on disk; the documentation SHALL name that persistence, the manual deletion, and the upstream `disabled` switch. Re-enabling SHALL require a full Harness restart.

#### Scenario: Row disabled

- **WHEN** the profile disables the `dsh-setup-hindsight` row
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

### Requirement: Live verification before release

Before publication, the owner acceptance SHALL pass against the release candidate in an isolated profile: a health check, a first session that stores a fact, a fresh session that recalls it, diagnostics naming the local endpoint, and a row-disable check for tools and injection. Automated repository checks MUST NOT require a running Hindsight server or an LLM key.

#### Scenario: Owner acceptance

- **WHEN** the owner runs the documented acceptance against the release candidate on a machine with the local Hindsight server and DeepSeek API key
- **THEN** the first session retains a fact, a fresh session recalls it or reads the corresponding knowledge page, diagnosis reports the loopback endpoint, and disabling the row stops the tools and injection

#### Scenario: Failed candidate blocks publication

- **WHEN** the release-candidate acceptance fails
- **THEN** the release tag is not pushed and no new market version is published

#### Scenario: Checks without a server

- **WHEN** the repository checks run on a machine with no Hindsight server
- **THEN** they pass without attempting a live memory call

### Requirement: Exact upstream pin and update path

The setup SHALL depend on one exact Hindsight package version. Updating that version MUST be a set release that bumps the pin, regenerates and rebuilds the setup, passes the repository checks, and repeats the live acceptance. The setup MUST NOT accept an unbounded version range or rely on the plugin's in-profile self-update for upgrades.

#### Scenario: Pinned installation

- **WHEN** the released setup is installed
- **THEN** the profile fetches the exact pinned Hindsight version and no other version

#### Scenario: Update release

- **WHEN** the owner updates Hindsight
- **THEN** the new version ships in a new set release, the previous release remains installable, and the live acceptance passes before publication

#### Scenario: No version drift

- **WHEN** repository validation inspects the Hindsight dependency
- **THEN** it reports an error for a range, a latest tag, or a version other than the recorded exact pin

### Requirement: Default-on durable export

The `dsh-setup-hindsight` row SHALL default `export.enabled` to true and expose the target directory, interval, auto-commit, auto-push, history, and attachment settings. Disabling export MUST stop all Git activity without affecting memory. The target directory MUST default outside the DSH home.

#### Scenario: Default configuration

- **WHEN** the setup is installed and no export configuration overrides the row
- **THEN** export is enabled and writes to a directory outside the DSH home

#### Scenario: Export disabled

- **WHEN** the row or machine-local configuration sets `export.enabled` to false
- **THEN** the plugin writes no export files and runs no Git command

#### Scenario: Target outside the DSH home

- **WHEN** the default target directory is resolved
- **THEN** it is not under the DSH home or the Hindsight `pg0` instance path

### Requirement: Native transfer archive as JSON

The exporter SHALL obtain each bank through the Hindsight bank transfer API and store the archive's JSON entries verbatim under one folder per bank, with a manifest and checksums. It MUST NOT store embeddings, MUST exclude history and attachments unless enabled, and MUST keep the local export outside the DSH home and `pg0` paths.

#### Scenario: Bank folder

- **WHEN** a bank is exported
- **THEN** its transfer archive entries and a manifest with counts and checksums are written under one sanitized bank folder

#### Scenario: No embeddings

- **WHEN** the archive is written
- **THEN** it contains no embedding vectors and records the Hindsight schema version

#### Scenario: Opt-in history and attachments

- **WHEN** history or attachments are not enabled
- **THEN** the export omits those archive sections

### Requirement: Export scheduling and failure isolation

The exporter SHALL run on the configured interval, after an idle session, and best-effort on dispose, using one writer at a time. It MUST be asynchronous, MUST fail open without blocking or crashing the Harness, MUST retry on the next cycle, and MUST commit only when exported content changes.

#### Scenario: Interval export

- **WHEN** the interval elapses and the local server is healthy
- **THEN** every bank is exported and changed content is committed

#### Scenario: Server unavailable

- **WHEN** the local Hindsight server is unreachable
- **THEN** the export attempt fails open, the Harness session continues, and the failure is observable

#### Scenario: Concurrent hosts

- **WHEN** two Host processes attempt an export at the same time
- **THEN** one writer holds the lock and the other skips the cycle

#### Scenario: Unchanged content

- **WHEN** an export produces the same content as the last committed snapshot
- **THEN** no new commit is created

### Requirement: Git commit and automatic push

The exporter SHALL commit to a dedicated private Git repository and push automatically to its configured remote without force. Remote URL and credentials MUST come from machine-local configuration and never from tracked files. Authentication or network failures MUST leave local commits intact and retry later without user prompts.

#### Scenario: Successful push

- **WHEN** a changed snapshot is committed and the private remote is reachable
- **THEN** the commit is pushed without force

#### Scenario: Push failure

- **WHEN** authentication or the network fails
- **THEN** the local commit remains, no interactive prompt appears, and a later cycle retries the push

#### Scenario: No remote

- **WHEN** no remote is configured
- **THEN** exports are committed locally and no push is attempted

#### Scenario: No tracked remote or credential

- **WHEN** repository validation inspects the setup and plugin files
- **THEN** it finds no export remote URL, credential, or machine path

### Requirement: Manual restore from exported JSON

The repository SHALL ship a manual restore script that rebuilds the transfer archive from the exported JSON tree and imports it, with dry-run and count verification. Restore MUST target an absent bank; merge MAY recover documents into an existing bank. The script MUST support cloning the private remote when the local export is gone and MUST offer the offline `hindsight-admin` fallback.

#### Scenario: Restore after data loss

- **WHEN** the database is empty and a snapshot exists
- **THEN** the script restores each bank and verifies the imported counts against the manifest

#### Scenario: Existing bank

- **WHEN** restore targets a bank that already exists
- **THEN** the script refuses the restore and names the merge option

#### Scenario: Dry run

- **WHEN** the script runs in dry-run mode
- **THEN** it reports the planned imports and changes no bank

#### Scenario: Remote-only copy

- **WHEN** the local export directory is gone but the private remote is configured
- **THEN** the script clones the remote and restores from it

#### Scenario: Verification mismatch

- **WHEN** imported counts differ from the manifest
- **THEN** the script reports the mismatch and exits non-zero

### Requirement: Export privacy and documentation

Export MUST default to a private remote, MUST keep history and attachments off unless enabled, and MUST document that memory may contain conversation text and secrets. Repository validation MUST find no remote URL, credential, or machine path in tracked files.

#### Scenario: Private remote

- **WHEN** the owner configures the remote
- **THEN** the documentation requires a private repository and no automatic push without a configured remote

#### Scenario: Default export scope

- **WHEN** export runs with default settings
- **THEN** history and attachments are omitted

#### Scenario: Documentation

- **WHEN** the owner reads the Hindsight page
- **THEN** it explains the export layout, the restore procedure, the Git credential requirement, and the privacy boundary
