# Spec Delta

## ADDED Requirements

### Requirement: Bundled Codex binary

The fork SHALL declare the current latest stable `@openai/codex` npm release (`0.164.0`) as a
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

### Requirement: Bundled Codex discovery

The provider SHALL resolve Codex from `codexPath`, then the pinned `@openai/codex` platform package,
then `PATH`, validating with `--version`. `PATH` is tried only when `codexPath` is omitted and no
bundled binary is discovered; a discovered executable whose `--version` fails is a terminal startup
error. It MUST report the path and source when none resolves.

#### Scenario: Explicit path

- **WHEN** `codexPath` is set to an existing executable
- **THEN** that executable wins and its source is `config`

#### Scenario: Bundled binary

- **WHEN** `codexPath` is omitted and the pinned package is installed
- **THEN** the provider uses the bundled platform binary and records the source as `bundled`

#### Scenario: PATH fallback

- **WHEN** `codexPath` is omitted, no bundled binary is discovered, and `codex` is on PATH
- **THEN** the provider uses the PATH command and records the source as `PATH`

#### Scenario: Missing CLI

- **WHEN** no source resolves
- **THEN** the run fails with the `codexPath` config key and the status-tool next action

#### Scenario: Invalid CLI

- **WHEN** the selected `codexPath` or discovered bundled executable does not exist or `--version`
  fails
- **THEN** the provider reports the path and command failure instead of falling back to `PATH` or
  starting an app-server

### Requirement: Serena app-server configuration

The provider SHALL pass the Serena MCP server configuration to the bundled Codex through `-c`
`mcp_servers.serena...` overrides on the app-server command. It MUST force Serena enabled and
required in the child (overriding an inherited `enabled=false`) so a missing runtime fails the run,
MUST pin `mcp_servers.serena.cwd` to the run's working directory (the isolated worktree for the write
instance) instead of accepting an inherited cwd, use the existing `~/.codex` login, and MUST NOT
create, copy, or write credentials or rewrite the user's config; Codex-managed token refresh is
allowed.

#### Scenario: Serena configured

- **WHEN** the provider starts the app-server
- **THEN** the child argument list contains the Serena `-c` overrides (`command`, `args`, `cwd`,
  `enabled=true`, `required=true`), the `SERENA_HOME` is a precreated per-run directory with empty
  project trust and a run-scoped project data folder whose resolved directory is also precreated, and
  the Serena MCP tools are exposed

#### Scenario: User config untouched

- **WHEN** the provider starts or the status tool runs
- **THEN** the provider creates, copies, or writes no credentials and leaves `~/.codex/config.toml`
  byte-identical; Codex-managed token refresh and runtime state are allowed, and the user's Serena
  config is neither used nor rewritten

#### Scenario: Serena runtime missing

- **WHEN** the Serena server command is not available
- **THEN** the required Serena startup makes the Codex run fail visibly with a next action, and the
  user's config is unchanged

### Requirement: Serena tool restrictions

The provider SHALL disable every mutating Serena tool and `activate_project` in BOTH the read-only
`codex-subagent` and the workspace-write `codex-subagent-write` instances (overriding an inherited
per-tool approval and project trust), because Serena's local MCP tools and project-activation hooks
run outside the Codex sandbox; the write instance edits only through the Codex sandbox in its
isolated worktree.

#### Scenario: Read-only Serena tools

- **WHEN** the read-only `codex-subagent` instance starts the app-server, even with an inherited
  `mcp_servers.serena.tools.replace_symbol_body.approval_mode = "approve"` or a trusted project
  activation hook
- **THEN** the child overrides disable every mutating Serena tool and `activate_project`, so a
  review cannot create, edit, rename, or delete repository files through Serena or its hooks

### Requirement: Serena run isolation

The provider SHALL start Serena with an explicit `--project=<run working directory>` and a run-scoped
`SERENA_HOME` whose precreated config has empty project trust and a run-scoped
`project_serena_folder_location` for that exact directory, with that resolved project data directory
precreated as well. The exact run working directory (not the nearest ancestor) MUST be the active
project, activation hooks MUST NOT run, and Serena's startup project files MUST stay out of the
checkout even when the working directory is nested beneath an ancestor project; the user's Serena
config MUST NOT be used or rewritten.

#### Scenario: Serena symbol read

- **WHEN** a run targets either provider
- **THEN** a project-dependent Serena symbol read succeeds in the run's working directory (for the
  write instance, in its isolated worktree), no activation hook runs, and the session checkout is
  unchanged even when it already contains `.serena` project files, including an incomplete
  `project.yml` and a missing `.gitignore`, and even when the working directory is nested beneath an
  ancestor project with an existing `.serena`

### Requirement: Codex login

The user SHALL authenticate the bundled Codex once, and the provider MUST use that login without
embedding, copying, or prompting for credentials. The status tool and documentation SHALL give the
exact login command and the `~/.codex` path.

#### Scenario: Logged in

- **WHEN** `~/.codex` contains a valid ChatGPT login
- **THEN** a delegation turn completes without a 401

#### Scenario: Not logged in

- **WHEN** the app-server returns an authentication failure
- **THEN** the run reports the login next action and writes no credentials

### Requirement: Security and bundled Codex

The fork SHALL install the pinned Codex npm package but MUST NOT sign in, copy auth, or write
credentials. It MUST spawn with fixed arguments, keep credentials out of records and logs, and
document that the user's Codex sandbox and config govern the target.

#### Scenario: No sign-in automation

- **WHEN** the package is installed
- **THEN** it contains no sign-in automation and no auth file

#### Scenario: Fixed spawn arguments

- **WHEN** the provider starts the CLI
- **THEN** the argument list is fixed and the prompt travels through stdin

#### Scenario: No secret leakage

- **WHEN** a record or log is written
- **THEN** it contains no credentials or tokens

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
- **THEN** the README names the bundled-binary resolution, the `-c` config patch, and the rebase procedure

#### Scenario: No official dependency

- **WHEN** the profile does not install the official Codex provider
- **THEN** the fork still registers its providers

### Requirement: Windows command handling

On Windows the provider SHALL spawn a `.cmd`/`.bat` through `ComSpec` with fixed arguments and an
`.exe` directly, including the bundled binary. It MUST pass the delegation prompt through the
app-server stdin rather than a shell. The resolved path and version MUST be available from
`codex_subagent_status`.

#### Scenario: CMD shim

- **WHEN** the resolved command is a `codex.cmd` npm shim
- **THEN** the provider starts it through `ComSpec` and the app-server protocol still works

#### Scenario: EXE

- **WHEN** the resolved source is `codex.exe`, including the bundled one
- **THEN** the provider spawns it directly with no shell wrapper

#### Scenario: Prompt transport

- **WHEN** a review or answer prompt is sent
- **THEN** it reaches the app-server through stdin and is not interpolated into a command line

### Requirement: Provider instances and status

The fork SHALL register a read-only `codex-subagent` provider and a workspace-write
`codex-subagent-write` provider, and a `codex_subagent_status` tool that reports the resolved path,
version, source (`config`, `bundled`, or `PATH`), bundled version, Serena configuration, login
command, and a paste-ready `codexPath` snippet. It MUST NOT write the profile patch or `~/.codex`
automatically.

#### Scenario: Read-only instance

- **WHEN** a review or answer rule targets `codex-subagent`
- **THEN** the run uses the read-only instance with the mutating Serena tools disabled

#### Scenario: Write instance

- **WHEN** a patch rule targets `codex-subagent-write`
- **THEN** the run uses the workspace-write instance in the rule's isolated worktree with the mutating
  Serena tools and `activate_project` disabled; edits go through the Codex sandbox, so the session
  checkout outside the worktree is never touched

#### Scenario: Status

- **WHEN** `codex_subagent_status` is called
- **THEN** it reports the path, version, source, bundled version, Serena config, login command, and a snippet for pinning `codexPath`

#### Scenario: No profile write

- **WHEN** the status tool reports a detected path
- **THEN** the profile's `cordis.patch.yml` and `~/.codex` are unchanged

### Requirement: App-server execution

The provider SHALL start the bundled (or selected) Codex with the official `app-server --stdio`
protocol adapter retained from upstream and the Serena `-c` overrides, and MUST surface protocol
startup failures, non-completed runs, cancellation, and timeouts as explicit errors. The bundled
`0.164.0` handshake and a completed authenticated turn are required acceptance checks.

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
Serena config, the login step, the cost, the provider names, and the MIT attribution.

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the fork, mounts `dsh-setup-codex-subagent` once, and installs the Codex dependency

#### Scenario: Removal

- **WHEN** the row is disabled or uninstalled
- **THEN** the providers and status tool disappear and Codex-targeted rules report the target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the documentation or market card
- **THEN** it names the bundled version, overrides, Serena config, login, cost, provider names, and MIT notice

### Requirement: Maintenance and DSH support

The fork SHALL record its upstream version and rebase procedure, pin the bundled Codex version, and
a DSH support-version or Codex version change MUST include rebasing/updating the fork and re-running
its app-server acceptance. The copied code MUST stay isolated in this package so an upstream update
does not touch the generic rules engine.

#### Scenario: DSH bump

- **WHEN** the repository's supported DSH version changes
- **THEN** the fork is rebased and its acceptance re-run before release

#### Scenario: Codex bump

- **WHEN** the pinned `@openai/codex` version changes
- **THEN** the lockfile, status, docs, and acceptance are updated together

#### Scenario: Isolation

- **WHEN** the fork is updated
- **THEN** only the fork package's vendored code changes, not the generic engine

## REMOVED Requirements

### Requirement: Security and no bundled Codex

**Reason**: Replaced by the bundled Codex binary and the user's existing `~/.codex` auth/login.

**Migration**: Use the bundled `@openai/codex` dependency; `codexPath` and `PATH` remain overrides;
the security rules move to the added `Security and bundled Codex` requirement.

### Requirement: Installed Codex discovery

**Reason**: Replaced by bundled discovery after the fork started shipping the pinned `@openai/codex`
package.

**Migration**: Use `codexPath` for explicit overrides; the bundled package is the default; `PATH`
remains a fallback. The added `Bundled Codex discovery` requirement defines the new order.
