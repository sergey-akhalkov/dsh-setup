# Spec Delta

## ADDED Requirements

### Requirement: Visible Codex subagent

The fork SHALL register a `codex_subagent` tool that starts a parent-delivered activation on the
read-only `codex-subagent` provider and returns the child's name, so the run is cataloged as an
external child in the delegating Session's subagent list; the child's answer MUST arrive as a
settlement notice. The tool MUST NOT start a local DSH Session or accept follow-up input.

#### Scenario: Cataloged run

- **WHEN** an Agent calls `codex_subagent` with a task description, a prompt, and an optional child name
- **THEN** the tool starts a parent-delivered activation on `codex-subagent` and returns the child's
  name, and the Session's subagent list shows the run as an external entry with the task description
  and the child name

#### Scenario: Notice delivery

- **WHEN** the external child completes
- **THEN** the parent Agent receives the settlement notice containing the answer, and the entry stays
  a leaf

#### Scenario: No follow-up

- **WHEN** a message targets the external child
- **THEN** delivery is refused because the backend is not continuable

#### Scenario: Read-only

- **WHEN** the tool runs
- **THEN** it uses the read-only `codex-subagent` provider and its `read-only` sandbox; write work
  stays on the `delegate` patch rule

#### Scenario: No calling agent

- **WHEN** the tool is invoked without a calling Agent
- **THEN** it fails and starts no activation

## MODIFIED Requirements

### Requirement: Forked provider base and license

The bundle SHALL vendor the MIT-licensed `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3` provider code
as its base, record the upstream source and license in a NOTICE/README, and document the local patch.
It MUST NOT depend on the official Codex provider package at runtime.

#### Scenario: Upstream base

- **WHEN** the fork package is inspected
- **THEN** it contains the upstream provider code, its MIT notice, and the recorded upstream version

#### Scenario: Local patch record

- **WHEN** a maintainer compares the fork with upstream
- **THEN** the README names the bundled-binary resolution, the read-only/workspace-write provider wiring, and the rebase procedure

#### Scenario: No official dependency

- **WHEN** the profile does not install the official Codex provider
- **THEN** the fork still registers its providers

### Requirement: Provider instances and status

The fork SHALL register a read-only `codex-subagent` provider and a workspace-write
`codex-subagent-write` provider, and a `codex_subagent_status` tool that reports the resolved path,
version, source (`config`, `bundled`, or `PATH`), bundled version, login command, and a paste-ready
`codexPath` snippet. It MUST NOT write the profile patch or `~/.codex` automatically.

#### Scenario: Read-only instance

- **WHEN** a review or answer rule targets `codex-subagent`
- **THEN** the run uses the read-only instance with `sandbox: read-only`

#### Scenario: Write instance

- **WHEN** a patch rule targets `codex-subagent-write`
- **THEN** the run uses the workspace-write instance in the rule's isolated worktree; edits made
  through the Codex tools go through the Codex sandbox, and the worktree-confinement guarantee
  covers only those operations

#### Scenario: Inherited MCP boundary

- **WHEN** the user's `~/.codex` configuration starts an MCP server (for example Serena) with
  approved mutation tools or a trusted activation hook
- **THEN** the provider adds no `mcp_servers.*` app-server override and the child runs that server
  with the user's own approvals, outside the Codex sandbox and outside the worktree-confinement
  guarantee

#### Scenario: Status

- **WHEN** `codex_subagent_status` is called
- **THEN** it reports the path, version, source, bundled version, login command, and a snippet for pinning `codexPath`

#### Scenario: No profile write

- **WHEN** the status tool reports a detected path
- **THEN** the profile's `cordis.patch.yml` and `~/.codex` are unchanged

### Requirement: App-server execution

The provider SHALL start the bundled (or selected) Codex with the official `app-server --stdio`
protocol adapter retained from upstream and MUST surface protocol startup failures, non-completed
runs, cancellation, and timeouts as explicit errors. The bundled `0.169.0` handshake and a completed
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

### Requirement: Setup, removal, and documentation

The setup SHALL deliver the fork and install its `@openai/codex` dependency closure. Disable/removal
SHALL unregister the providers and status tool without deleting records or worktrees. The
documentation and market card MUST name the bundled version and `codexPath`/PATH overrides, the
login step, the cost, the provider names, and the MIT attribution.

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the fork, mounts `dsh-setup-codex-subagent` once, and installs the Codex dependency

#### Scenario: Removal

- **WHEN** the row is disabled or uninstalled
- **THEN** the providers and status tool disappear and Codex-targeted rules report the target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the documentation or market card
- **THEN** it names the bundled version, overrides, login, cost, provider names, and MIT notice, and
  states that user-configured `~/.codex` MCP servers run with their own approvals outside the Codex
  sandbox and outside the worktree-confinement guarantee

### Requirement: Review conversation confinement

A reused review thread MUST remain confined to the run's working directory and sandbox. The
persisted thread id MUST stay local scratch and MUST be removed with the delegation state; the
user's Codex config MUST NOT be used or rewritten for the reuse. A provider restart MUST resume from
the persisted thread id or report the missing thread and start a new one.

#### Scenario: Persisted state

- **WHEN** the provider restarts between two reviews of one key
- **THEN** it resumes from the persisted thread id (or reports the missing thread and starts a new one) without touching the user's Codex config

#### Scenario: Confinement

- **WHEN** a reused thread runs a review
- **THEN** the run's cwd and sandbox still apply

### Requirement: Bundled Codex binary

The fork SHALL declare the current latest stable `@openai/codex` npm release (`0.169.0`) as a
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

## REMOVED Requirements

### Requirement: Serena app-server configuration

**Reason**: Serena is the session's lazy MCP server, not a required dependency of every Codex
delegation. The fixed `-c mcp_servers.serena...` overrides, the throwaway `SERENA_HOME`, and the
required-server startup made `uvx`/`serena-agent` a prerequisite of every review and patch.

**Migration**: No profile action. Codex children now use the user's `~/.codex` configuration as-is;
a user who wants Serena in Codex can configure it there. The setup's lazy `serena` MCP entry and the
Serena guidance bundle are unchanged.

### Requirement: Serena tool restrictions

**Reason**: With no Serena MCP server configured by the provider, there are no out-of-sandbox
Serena tools or activation hooks to restrict. The Codex sandbox remains the write boundary for both
provider instances.

**Migration**: No profile action. The read-only instance keeps `sandbox: read-only`; the write
instance keeps `workspace-write` in the isolated worktree.

### Requirement: Serena run isolation

**Reason**: The provider no longer starts Serena, so the per-run `--project` pin, throwaway home,
and run-scoped data folder no longer exist.

**Migration**: No profile action. Review threads remain confined to the run's working directory and
sandbox.
